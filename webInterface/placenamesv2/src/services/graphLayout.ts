/** Deterministic polar-coordinate radial tree layout for the knowledge graph — replaces Cytoscape's non-deterministic "cose" physics layout; the same graph shape always produces the same positions. */

import type { GraphNode, GraphEdge } from "../types/graph";
import { nodeBaseSize, EDGE_LABEL_FONT_SIZE } from "./graphNodeStyles";

/** Consistent left-to-right/angular ordering for a node's children, by type. */
const TYPE_ORDER: Record<string, number> = {
  geometry: 0,
  placeName: 1,
  classification: 2,
  place: 3, // cross-border (skos:exactMatch) places
  metaData: 4,
  resource: 5,
  literal: 6,
  showMore: 7,
};

function typeRank(type: string | undefined): number {
  return TYPE_ORDER[type ?? ""] ?? 8;
}

export interface LayoutPosition {
  x: number;
  y: number;
}

/** Ring spacing that scales with node count — a fixed distance for every graph size forced
 *  cy.fit() to zoom out on small graphs, shrinking text. Shared by computeRadialLayout and the expansion call site for consistent ring distance. */
export function adaptiveRadiusStep(nodeCount: number): number {
  const MIN_STEP = 190;
  const MAX_STEP = 260;
  const MIN_NODES = 10;
  const MAX_NODES = 30;
  if (nodeCount <= MIN_NODES) return MIN_STEP;
  if (nodeCount >= MAX_NODES) return MAX_STEP;
  const t = (nodeCount - MIN_NODES) / (MAX_NODES - MIN_NODES);
  return MIN_STEP + t * (MAX_STEP - MIN_STEP);
}

/** Absolute floor on any single hop — a safety net for a degenerate zero-radius case;
 *  normal circles already exceed this on their own. */
const MIN_HOP = 40;
/** Margin reserved on each side of a label's own footprint, beyond the endpoint circles —
 *  big enough for a visible arrowhead, small enough that it doesn't balloon across a multi-hop chain. */
const LABEL_CLEARANCE = 13;

/** Lazily-created, reused canvas context for MEASURING text only — never drawn to. */
let measureCtx: CanvasRenderingContext2D | null | undefined;

function getMeasureContext(): CanvasRenderingContext2D | null {
  if (measureCtx === undefined) {
    measureCtx = typeof document === 'undefined'
      ? null
      : document.createElement('canvas').getContext('2d');
    // Same font the label actually renders with, so measureText reflects real glyph widths.
    if (measureCtx) measureCtx.font = `${EDGE_LABEL_FONT_SIZE}px Helvetica Neue, Helvetica, sans-serif`;
  }
  return measureCtx;
}

/** Real rendered pixel width of an edge label via canvas measureText, not a flat
 *  per-character guess — a guess calibrated safe for long labels overshoots short ones. */
export function estimateLabelWidth(label: string | undefined): number {
  if (!label) return 0;
  const ctx = getMeasureContext();
  return ctx ? ctx.measureText(label).width : label.length * 7;
}

/** Radial distance from a parent to one child, sized to clear both circles plus this hop's
 *  own edge label — not a flat per-edge gap, and not capped by the adaptive radiusStep since label-overlap correctness outweighs spacing consistency. */
function stepForChild(parentType: string | undefined, childType: string | undefined, edgeLabel: string | undefined): number {
  // No parentType means the root ring (measured from true centre) — no parent circle to clear.
  const parentRadius = parentType ? nodeBaseSize(parentType) / 2 : 0;
  const childRadius = nodeBaseSize(childType ?? '') / 2;
  const minNeeded = parentRadius + childRadius + estimateLabelWidth(edgeLabel) + LABEL_CLEARANCE * 2;
  return Math.max(minNeeded, MIN_HOP);
}

/** Extra breathing room between two adjacent siblings' circles, on top of their own diameters. */
const SIBLING_ARC_GAP = 24;

/** Fraction of a parent's angular span reserved as dead space between sibling branches — without it, a zero-gap seam lets a thin branch sit right beside its neighbour's own content; applied at every recursion level so gaps compound. */
const SIBLING_ANGULAR_GAP_FRACTION = 0.08;

/** Minimum arc reserved for one child, sized to its own circle (not a flat fraction of radiusStep, which let small literals steal room from full entities) plus its incoming edge label's own footprint. */
function minArcForChild(childType: string | undefined, edgeLabel?: string): number {
  return nodeBaseSize(childType ?? '') + SIBLING_ARC_GAP + estimateLabelWidth(edgeLabel);
}

/** Solves via law of cosines for a child's radius so its straight-line distance from the angularly-offset parent is exactly minDist (naively adding minDist to the parent's radius under-corrects for a wide sector); clamped never radially inside the parent. */
function radiusForChild(parentRadius: number, parentAngle: number, childAngle: number, minDist: number): number {
  const dTheta = childAngle - parentAngle;
  const perp = parentRadius * Math.sin(dTheta);
  const remaining = Math.sqrt(Math.max(0, minDist * minDist - perp * perp));
  const r = parentRadius * Math.cos(dTheta) + remaining;
  return Math.max(r, parentRadius);
}

export interface RadialLayoutResult {
  positions: Map<string, LayoutPosition>;
}

/** Computes deterministic (x, y) positions for every node as a radial tree rooted at
 *  `rootIds`. A node reachable from multiple parents is positioned once, via whichever reaches it first — other relationships still draw as edges without dictating position. */
export function computeRadialLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  rootIds: string[]
): RadialLayoutResult {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const outgoingByNode = new Map<string, string[]>();
  for (const n of nodes) outgoingByNode.set(n.id, []);
  // First label found per parent→child pair — a shared node only ever gets one layout parent.
  const edgeLabelByPair = new Map<string, string>();
  for (const e of edges) {
    if (outgoingByNode.has(e.source) && nodeById.has(e.target)) {
      outgoingByNode.get(e.source)!.push(e.target);
      const key = `${e.source} ${e.target}`;
      if (!edgeLabelByPair.has(key)) edgeLabelByPair.set(key, e.label);
    }
  }

  const validRoots = Array.from(new Set(rootIds.filter((id) => nodeById.has(id))));
  // Fall back to any node with no incoming edge if no valid root was supplied.
  if (validRoots.length === 0) {
    const hasIncoming = new Set(edges.map((e) => e.target));
    for (const n of nodes) {
      if (!hasIncoming.has(n.id)) validRoots.push(n.id);
    }
    if (validRoots.length === 0 && nodes.length > 0) validRoots.push(nodes[0].id);
  }

  // Spanning tree via BFS: each node gets exactly one "layout parent" (the first edge
  // that reaches it), children sorted into a stable type order.
  const children = new Map<string, string[]>();
  const visited = new Set<string>(validRoots);
  for (const r of validRoots) {
    children.set(r, []);
  }

  // Shared by the main BFS and the extraRoots fallback below — so a node wrongly excluded
  // from validRoots (e.g. by a reciprocal exactMatch edge) still gets its own subtree, not a bare leaf.
  function bfsFrom(startId: string) {
    const queue = [startId];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      const outs = (outgoingByNode.get(cur) ?? [])
        .filter((t) => !visited.has(t))
        .sort((a, b) => typeRank(nodeById.get(a)?.type) - typeRank(nodeById.get(b)?.type));
      for (const t of outs) {
        visited.add(t);
        children.set(cur, [...(children.get(cur) ?? []), t]);
        children.set(t, []);
        queue.push(t);
      }
    }
  }

  for (const r of validRoots) bfsFrom(r);

  // Any disconnected fragment becomes its own root, with the same BFS treatment.
  const extraRoots: string[] = [];
  for (const n of nodes) {
    if (!visited.has(n.id)) {
      visited.add(n.id);
      extraRoots.push(n.id);
      children.set(n.id, []);
      bfsFrom(n.id);
    }
  }
  const allRoots = [...validRoots, ...extraRoots];

  // Bottom-up: each node's "weight" = its angular share, proportional to leaf count.
  const weight = new Map<string, number>();
  function computeWeight(id: string): number {
    const kids = children.get(id) ?? [];
    if (kids.length === 0) {
      weight.set(id, 1);
      return 1;
    }
    let sum = 0;
    for (const c of kids) sum += computeWeight(c);
    const w = Math.max(sum, 1);
    weight.set(id, w);
    return w;
  }
  for (const r of allRoots) computeWeight(r);

  const positions = new Map<string, LayoutPosition>();

  // Single root sits at radius 0; several roots (shared-geometry places) share a ring
  // sized for a place-type node's clearance instead of stacking at the centre.
  const rootRadius = allRoots.length > 1 ? stepForChild(undefined, 'place', undefined) : 0;

  // Radius passed down explicitly (parent's radius + this hop's distance) rather than
  // depth × one uniform step, so siblings can sit at different distances.
  function assign(id: string, radius: number, angleStart: number, angleEnd: number, angleOverride?: number) {
    const kids = children.get(id) ?? [];
    const mid = angleOverride ?? (angleStart + angleEnd) / 2;
    positions.set(id, { x: radius * Math.cos(mid), y: radius * Math.sin(mid) });

    if (kids.length === 0) return;

    const parentType = nodeById.get(id)?.type;
    const span = angleEnd - angleStart;
    const totalWeight = kids.reduce((s, c) => s + (weight.get(c) ?? 1), 0);

    // Reserve a real gap at every boundary between sibling branches (none needed for a
    // single child), then divide what's left proportionally — see SIBLING_ANGULAR_GAP_FRACTION.
    const gapBudget = kids.length > 1 ? span * SIBLING_ANGULAR_GAP_FRACTION : 0;
    const gapPerBoundary = kids.length > 1 ? gapBudget / (kids.length - 1) : 0;
    const usableSpan = span - gapBudget;

    // A lone child's raw angle equals its parent's exactly, so a chain of single-child hops collides on the same bearing — angleOverride nudges only the reported angle, curving the chain without touching the angular window.
    const soleChildBias = kids.length === 1 ? Math.min(0.3, usableSpan * 0.3) : 0;

    let cursor = angleStart;
    for (const c of kids) {
      const edgeLabel = edgeLabelByPair.get(`${id} ${c}`);
      const childType = nodeById.get(c)?.type;
      // Desired straight-line distance from parent to child (fits this edge's own label).
      const minDist = stepForChild(parentType, childType, edgeLabel);
      const childSpan = usableSpan * ((weight.get(c) ?? 1) / totalWeight);
      const childMid = cursor + childSpan / 2 + soleChildBias;
      // Floored at this child's own needed-arc-radius, computed per child not shared across the ring, so one narrow-sliced sibling can't drag every other edge out.
      const neededArcRadius = childSpan > 0 ? minArcForChild(childType, edgeLabel) / childSpan : 0;
      const childRadius = Math.max(radiusForChild(radius, mid, childMid, minDist), neededArcRadius);
      assign(c, childRadius, cursor, cursor + childSpan, soleChildBias ? childMid : undefined);
      cursor += childSpan + gapPerBoundary;
    }
  }

  if (allRoots.length === 1) {
    assign(allRoots[0], 0, 0, 2 * Math.PI);
  } else {
    const totalWeight = allRoots.reduce((s, r) => s + (weight.get(r) ?? 1), 0);
    // Same widen-for-lightest-slice reasoning as assign()'s ringRadius calc, and the same
    // sibling-gap reasoning as assign()'s own split — reserve dead space between root branches.
    const rootGapBudget = allRoots.length > 1 ? 2 * Math.PI * SIBLING_ANGULAR_GAP_FRACTION : 0;
    const rootGapPerBoundary = allRoots.length > 1 ? rootGapBudget / (allRoots.length - 1) : 0;
    const usableRootSpan = 2 * Math.PI - rootGapBudget;
    const rootRingRadius = allRoots.reduce((r, root) => {
      const proportional = usableRootSpan * ((weight.get(root) ?? 1) / totalWeight);
      const needed = proportional > 0 ? minArcForChild('place') / proportional : 0;
      return Math.max(r, needed);
    }, rootRadius);
    let cursor = 0;
    for (const r of allRoots) {
      const share = (weight.get(r) ?? 1) / totalWeight;
      const span = usableRootSpan * share;
      assign(r, rootRingRadius, cursor, cursor + span);
      cursor += span + rootGapPerBoundary;
    }
  }

  return { positions };
}

export interface ExpansionLayoutResult {
  positions: Map<string, LayoutPosition>;
}

/** Computes fan-out positions for newly-expanded child nodes, using the same type-ordering, outward-facing convention, and stepForChild hop logic as computeRadialLayout, so they land consistently with the rest of the graph. */
export function computeExpansionPositions(
  parentPos: LayoutPosition,
  newNodes: Array<{ id: string; type: string; label?: string }>,
  radiusStep = 260,
  parentType?: string
): ExpansionLayoutResult {
  const positions = new Map<string, LayoutPosition>();
  if (newNodes.length === 0) return { positions };

  // Direction away from the graph's centre — falls back to "east" if the parent is at origin.
  const outward =
    parentPos.x === 0 && parentPos.y === 0 ? 0 : Math.atan2(parentPos.y, parentPos.x);

  const sorted = [...newNodes].sort((a, b) => typeRank(a.type) - typeRank(b.type));
  const steps = sorted.map((node) => (parentType ? stepForChild(parentType, node.type, node.label) : radiusStep));

  // Each child's angular footprint at its own radius (arc length ≈ radius × angle) — same
  // minArcForChild reasoning as computeRadialLayout, adapted since siblings sit at different radii.
  const neededAngles = sorted.map((node, i) => minArcForChild(node.type, node.label) / steps[i]);
  const countBasedSpan = Math.min(Math.PI * 0.8, (Math.PI / 3) * sorted.length);
  const requiredGap = sorted.length > 1 ? Math.max(...neededAngles) : 0;
  const fanSpan = sorted.length <= 1 ? 0 : Math.min(Math.PI * 1.6, Math.max(countBasedSpan, requiredGap * (sorted.length - 1)));
  const start = outward - fanSpan / 2;

  // A single expanded child would otherwise continue exactly outward — same collinearity
  // risk as computeRadialLayout's sole-child case (see assign()); a small bias curves it.
  const soleChildBias = sorted.length === 1 ? 0.3 : 0;

  sorted.forEach((node, i) => {
    const angle =
      sorted.length === 1 ? outward + soleChildBias : start + (fanSpan * i) / (sorted.length - 1);
    const nodePos = {
      x: parentPos.x + steps[i] * Math.cos(angle),
      y: parentPos.y + steps[i] * Math.sin(angle),
    };
    positions.set(node.id, nodePos);
  });

  return { positions };
}
