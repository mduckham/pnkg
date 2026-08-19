import { useCallback, useState, useRef } from 'react';
import type { Core } from 'cytoscape';
import { GRAPH_CONFIG, EXPANSION_MESSAGES } from '../config/graphConfig';
import { countIncomingRelationships } from '../services/genericExpansion';
import { computeExpansionPositions, adaptiveRadiusStep } from '../services/graphLayout';
import { markExactMatchNodes } from '../utils/exactMatch';
import { panelPropertiesStore } from '../services/expansionHandlers';
import { extractLocalName } from '../services/labelExtractor';
import { formatWktLabel } from '../services/wktParser';
import { nodeTypeEdgeColor } from '../config/appConfig';
import { nodeBaseSize } from '../services/graphNodeStyles';
import type {
  IExpansionRegistry,
  ExpansionContext,
  ExpansionResult,
} from '../services/expansionRegistry';
import type { UseGraphStateReturn } from './useGraphState';

/** Panel-only predicates the initial render already shows as value circles — surfaced the same way during expansion (ids matching graphBuilder's own scheme) so a different chain doesn't look thinner.
 *  Per Nayomi/Prof's request, each id is keyed by the owning resource's own URI (nodeUri), not
 *  by the literal's text value — so e.g. two different PlaceNames both status "gazetted" get
 *  their own grey node each, v1-style, instead of sharing one distant node across the canvas.
 *  Only class/resource nodes (Place, PlaceName, MetaData, Geometry, Publisher, Location) stay
 *  deduplicated — that's unaffected by this, see uriToExistingId below. */
const VALUE_NODE_SPECS: Record<
  string,
  Array<{ predicate: string; edgeLabel: string; idFor: (nodeUri: string, value: string) => string }>
> = {
  geometry: [
    {
      predicate: 'http://www.opengis.net/ont/geosparql#asWKT',
      edgeLabel: 'geo:asWKT',
      idFor: (nodeUri) => `literal:wkt:${nodeUri}`,
    },
  ],
  placeName: [
    {
      predicate: 'http://linked.data.gov.au/def/placenames/name',
      edgeLabel: 'pn:name',
      idFor: (nodeUri) => `${nodeUri}::name`,
    },
    {
      predicate: 'http://linked.data.gov.au/def/placenames/status',
      edgeLabel: 'pn:status',
      idFor: (nodeUri) => `literal:status:${nodeUri}`,
    },
  ],
  publisher: [
    {
      predicate: 'http://xmlns.com/foaf/0.1/name',
      edgeLabel: 'foaf:name',
      idFor: (nodeUri) => `literal:pub:${nodeUri}`,
    },
  ],
  location: [
    {
      predicate: 'http://www.w3.org/2004/02/skos/core#prefLabel',
      edgeLabel: 'skos:prefLabel',
      idFor: (nodeUri) => `literal:loc:${nodeUri}`,
    },
  ],
};

/** Picks the right VALUE_NODE_SPECS set, disambiguating Publisher/Location/MetaData by URI (all share nodeType 'metaData'). */
function resolveValueSpecs(nodeUri: string, nodeType: string) {
  if (nodeType === 'metaData') {
    if (nodeUri.includes('/Publisher/')) return VALUE_NODE_SPECS.publisher;
    if (nodeUri.includes('/Location/')) return VALUE_NODE_SPECS.location;
    return undefined;
  }
  return VALUE_NODE_SPECS[nodeType];
}

/** How long a shared node's compromise-position move takes to animate. A single click only ever
 *  triggers a handful of these, but the recursive "expand a whole subtree" walk can trigger many
 *  in one gesture — at the original 550ms each, a walk touching several shared MetaData/
 *  Publisher/Location hubs visibly kept moving for several seconds after the data had already
 *  loaded ("here and there" for 4-5 seconds). Short enough now to read as a quick settle, not a
 *  jarring snap, without stacking up across a busy walk. */
const SHARED_REPOSITION_DURATION_MS = 220;

/** Minimum gap (beyond the two circles' own radii) a repositioned shared node/subtree must
 *  clear from anything it doesn't belong to. */
const SHARED_REPOSITION_GAP = 40;

/** Node types eligible for compromise-repositioning when shared — see repositionSharedNode's
 *  own doc comment for why this is deliberately narrow (metaData: MetaData/Publisher/Location;
 *  resource: naming Authority). classification/geometry/placeName/place stay put when shared —
 *  they're typically one hop from their parent(s), with no room to compromise into. */
const REPOSITIONABLE_SHARED_TYPES = new Set(['metaData', 'resource']);

/** Logical (post-animation) destinations for nodes a repositionSharedNode call has in flight —
 *  consulted instead of cy's own position() by anything that needs to know where a node REALLY
 *  ends up while its compromise-position move is still animating. Cytoscape's position() getter
 *  returns the currently-interpolated frame during an active .animate(), not the final value —
 *  a nested recursive expand into the very node just kicked off (e.g. expanding a MetaData hub
 *  right after it was repositioned, to reveal its own Publisher/Location) can run mid-tween and
 *  read a stale, transient position, anchoring the new children near the OLD spot while the
 *  parent keeps animating away — producing a branch that points in a completely different,
 *  sometimes near-reversed, direction from the rest of its own family (the "zig-zag" bug this
 *  guards against). Cleared once each node's own animation completes. */
const pendingNodeTargets = new Map<string, { x: number; y: number }>();

/** Authoritative "where does this node really sit" — the in-flight reposition target if one is
 *  pending, otherwise cy's own (settled) position. See pendingNodeTargets above. Exported so
 *  GraphPanel.tsx's own post-expansion overlap resolution (resolveNewSubtreeOverlaps) can treat
 *  a mid-repositioning node as an obstacle at its REAL destination too, not just this module's
 *  own layout math — a new node placed "safely" against a still-animating node's stale position
 *  is left overlapping once that animation finishes settling onto its real spot. */
export function authoritativePosition(cy: Core, nodeId: string): { x: number; y: number } {
  const pending = pendingNodeTargets.get(nodeId);
  if (pending) return pending;
  const node = cy.getElementById(nodeId);
  return node.length > 0 ? { x: node.position('x'), y: node.position('y') } : { x: 0, y: 0 };
}

/** True while ANY repositionSharedNode compromise-move (from ANY concurrent expansion — several
 *  cross-border places double-tapped in quick succession each run their own independent
 *  recursive walk, all interleaved) is still mid-flight. Lets GraphPanel.tsx's post-expansion
 *  overlap check wait for actual settle instead of guessing a fixed delay: too short and a late
 *  reposition from a DIFFERENT concurrent walk lands after the check already ran (nothing catches
 *  it); too long and a simple, common single-node expansion feels sluggish for no reason. */
export function hasPendingRepositions(): boolean {
  return pendingNodeTargets.size > 0;
}

/** When a node gains a second (or later) incoming edge — e.g. two PlaceNames sharing one
 *  MetaData node — moves it (and, as one rigid group preserving relative shape, any of its own
 *  already-expanded descendants) to the average position of ALL its current parents, instead of
 *  leaving it stuck wherever its first parent happened to place it. Nudges the whole group
 *  further along the same move direction if the raw average would land on top of something it
 *  doesn't belong to. Only for REPOSITIONABLE_SHARED_TYPES — a directly-shared node close to its
 *  parents (classification is one hop from a Place) has nowhere to go: two nearby Places sharing
 *  one classification just wedges it between them, worse than leaving it in place. Returns every
 *  node id that moved — empty if the node isn't actually shared (fewer than 2 parents) or isn't
 *  a repositionable type. */
function repositionSharedNode(cy: Core, targetId: string): string[] {
  const target = cy.getElementById(targetId);
  if (target.length === 0) return [];
  if (!REPOSITIONABLE_SHARED_TYPES.has(target.data('type'))) return [];
  // Publisher/Location share the 'metaData' type with the MetaData hub itself, but are
  // deliberately excluded from independent repositioning: they're one hop further out and meant
  // to visually read as part of whichever MetaData hub owns them (dragged along as part of ITS
  // rigid group below). Letting them independently recentre to their OWN compromise position
  // (between their own two MetaData parents, when a Publisher/Location happens to be reused
  // across two different chains) pulls them away from their hub, splitting one metadata "family"
  // across the canvas — the "scattered" look reported after two chains shared a Location.
  if (targetId.includes('/Publisher/') || targetId.includes('/Location/')) return [];

  const parentPositions: Array<{ x: number; y: number }> = [];
  target.incomers('edge').forEach((e) => {
    if (e.source().id() !== targetId) {
      parentPositions.push(authoritativePosition(cy, e.source().id()));
    }
  });
  if (parentPositions.length < 2) return []; // not actually shared (yet)

  const avgX = parentPositions.reduce((s, p) => s + p.x, 0) / parentPositions.length;
  const avgY = parentPositions.reduce((s, p) => s + p.y, 0) / parentPositions.length;

  // The node's own already-expanded subtree, via outgoing edges only, so the move never
  // reaches back up into unrelated parts of the graph. Cycle-guarded.
  const groupIds = new Set<string>([targetId]);
  const queue = [targetId];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    cy.getElementById(cur).outgoers('edge').forEach((e) => {
      const childId = e.target().id();
      if (!groupIds.has(childId)) {
        groupIds.add(childId);
        queue.push(childId);
      }
    });
  }

  const oldPos = authoritativePosition(cy, targetId);
  let dx = avgX - oldPos.x;
  let dy = avgY - oldPos.y;
  // Degenerate case (average lands exactly on the old spot) — still worth a small nudge so the
  // collision check below has a direction to push along; picks "away from origin" as a default.
  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) {
    const fallbackLen = Math.hypot(oldPos.x, oldPos.y) || 1;
    dx = (oldPos.x / fallbackLen) * 10 || 10;
    dy = (oldPos.y / fallbackLen) * 10;
  }

  // The group's existing children (Publisher/Location etc.) were positioned to continue outward
  // from wherever the target's FIRST parent reached it — a compromise move to the average of 2+
  // parents can land on a very different bearing, and a pure translation would carry that now-stale
  // direction along unchanged, sometimes pointing the fan almost back through the target itself
  // (the "zig-zag"/reversed-branch look reported for a shared MetaData's Publisher/Location).
  // Rotating the rest of the group around the target's OLD position — from its current fan
  // bearing to "away from the graph's centre" (the same convention every other outward-facing
  // branch in this layout already follows) — re-orients the whole family in one motion together
  // with the translation below, instead of just dragging it along facing the wrong way. Two
  // parents landing exactly on their own midpoint (avgX/avgY at the origin) has no meaningful
  // "away from centre" bearing either; skipped rather than picking an arbitrary one.
  const others = [...groupIds].filter((id) => id !== targetId);
  let rotation = 0;
  if (others.length > 0 && !(Math.abs(avgX) < 0.01 && Math.abs(avgY) < 0.01)) {
    let centroidX = 0, centroidY = 0;
    others.forEach((id) => {
      const p = authoritativePosition(cy, id);
      centroidX += p.x;
      centroidY += p.y;
    });
    centroidX /= others.length;
    centroidY /= others.length;
    if (Math.abs(centroidX - oldPos.x) >= 0.01 || Math.abs(centroidY - oldPos.y) >= 0.01) {
      const oldFanAngle = Math.atan2(centroidY - oldPos.y, centroidX - oldPos.x);
      const newOutward = Math.atan2(avgY, avgX);
      rotation = newOutward - oldFanAngle;
    }
  }
  const rotCos = Math.cos(rotation);
  const rotSin = Math.sin(rotation);

  // Obstacles: every node NOT in the moving group.
  const obstacles: Array<{ x: number; y: number; r: number }> = [];
  cy.nodes().forEach((n) => {
    if (!groupIds.has(n.id())) {
      const p = authoritativePosition(cy, n.id());
      obstacles.push({ x: p.x, y: p.y, r: nodeBaseSize(n.data('type')) / 2 });
    }
  });

  // Every group member's fixed offset from the target's OLD position (pre-rotation, pre-translation)
  // plus its own radius — computed once, reused by both the collision check below and the final
  // animate loop. The target itself has a zero offset.
  const members: Array<{ id: string; relX: number; relY: number; r: number }> = [];
  groupIds.forEach((id) => {
    const node = cy.getElementById(id);
    if (node.length === 0) return;
    const p = id === targetId ? oldPos : authoritativePosition(cy, id);
    members.push({
      id,
      relX: p.x - oldPos.x,
      relY: p.y - oldPos.y,
      r: nodeBaseSize(node.data('type')) / 2,
    });
  });

  // Candidate absolute position for a member at the current trial (dx, dy) — rotation is fixed
  // (decided above, from the family's own re-orientation), only the translation is adjusted here.
  const memberPos = (m: { relX: number; relY: number }, tdx: number, tdy: number) => ({
    x: oldPos.x + m.relX * rotCos - m.relY * rotSin + tdx,
    y: oldPos.y + m.relX * rotSin + m.relY * rotCos + tdy,
  });

  // Checks EVERY member of the moving group against every obstacle, not just the target — a
  // descendant (Publisher/Location, or a literal further down) dragged along by the rigid
  // group/rotation never got its own collision check before, so it could land on top of some
  // unrelated node anywhere else in a denser graph even though the target itself cleared fine.
  // Capped low deliberately: this pushes along ONE fixed direction (the compromise move itself),
  // extending further every time any member still collides — in a dense graph with obstacles
  // strung out along that ray, this can run for a very long way, stranding a member (e.g.
  // Location) far from the hub it's rigidly attached to even though the translation preserves
  // their relative distance exactly (the extra distance comes from HOW FAR the whole group ended
  // up getting pushed, not from anything breaking that rigidity). resolveResidualOverlaps'
  // later, proportional/bounded pass mops up whatever's still left after a few tries here.
  let iterations = 0;
  while (iterations < 3) {
    let collided = false;
    for (const m of members) {
      const pos = memberPos(m, dx, dy);
      for (const obs of obstacles) {
        const dist = Math.hypot(pos.x - obs.x, pos.y - obs.y);
        const needed = m.r + obs.r + SHARED_REPOSITION_GAP;
        if (dist < needed) {
          const dirLen = Math.hypot(dx, dy) || 1;
          const extra = (needed - dist) + 5;
          dx += (dx / dirLen) * extra;
          dy += (dy / dirLen) * extra;
          collided = true;
          break;
        }
      }
      if (collided) break;
    }
    if (!collided) break;
    iterations++;
  }

  const moved: string[] = [];
  members.forEach((m) => {
    const node = cy.getElementById(m.id);
    if (node.length === 0) return;
    const id = m.id;
    const { x: destX, y: destY } = memberPos(m, dx, dy);
    // Recorded BEFORE the animation starts so any code that runs concurrently (most importantly,
    // a nested recursive expand into this very node — see pendingNodeTargets' own doc comment)
    // reads the real destination instead of a mid-tween frame.
    pendingNodeTargets.set(id, { x: destX, y: destY });
    node.animate(
      { position: { x: destX, y: destY } } as any,
      {
        duration: SHARED_REPOSITION_DURATION_MS,
        complete: () => {
          if (pendingNodeTargets.get(id)?.x === destX && pendingNodeTargets.get(id)?.y === destY) {
            pendingNodeTargets.delete(id);
          }
        },
      }
    );
    moved.push(id);
  });

  return moved;
}

export interface UseGraphExpansionOptions {
  registry: IExpansionRegistry;
  cyRef: React.RefObject<Core | null>;
  graphState: UseGraphStateReturn;
  context: ExpansionContext;
  perExpansionLimit?: number;
  timeoutMs?: number;
}

/** Outcome of one expand() call — returned so a caller making several in one gesture (the recursive dbltap walk) can aggregate an accurate summary instead of relying on lastNotice/lastError, which only reflect the most recent call. */
export interface ExpandOutcome {
  status: 'expanded' | 'terminal' | 'skipped' | 'error';
  /** True when non-exactMatch relationships were sampled (status === 'expanded'). */
  truncated?: boolean;
  /** status === 'terminal' only: count of other resources pointing AT this node (reverse direction). */
  incomingCount?: number;
}

export interface UseGraphExpansionReturn {
  expand(nodeId: string, nodeType: string): Promise<ExpandOutcome>;
  collapse(nodeId: string): void;
  isExpanding: boolean;
  /** True if any expand() call, from any concurrent walk, is currently in flight — unlike
   *  isExpanding (a single boolean, unreliable once more than one expand() overlaps in time),
   *  reads a live Set each call. See its own doc comment above. */
  hasInFlightExpansions(): boolean;
  lastError: string | null;
  /** Informational feedback (sampling / dead-end) — distinct from lastError, nothing went wrong. */
  lastNotice: { message: string; type: 'warning' } | null;
  /** Resets lastNotice/lastError to null — see its own doc comment above. */
  clearNotice(): void;
}

/** Orchestrates expansion/collapse: debouncing, budget checks, registry dispatch, timeout enforcement, result integration into Cytoscape, and layout animation. */
export function useGraphExpansion(
  options: UseGraphExpansionOptions
): UseGraphExpansionReturn {
  const {
    registry,
    cyRef,
    graphState,
    context,
    perExpansionLimit = GRAPH_CONFIG.PER_EXPANSION_LIMIT,
    timeoutMs = GRAPH_CONFIG.QUERY_TIMEOUT_MS,
  } = options;

  const [isExpanding, setIsExpanding] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastNotice, setLastNotice] = useState<{ message: string; type: 'warning' } | null>(null);

  // Tracks in-flight queries per node for debounce
  const inFlightRef = useRef<Set<string>>(new Set());

  /** Animates newly-added nodes to their already-computed deterministic positions — no physics, which would reintroduce non-determinism. */
  const runLayout = useCallback(
    (animate: boolean = true, newNodeIds?: string[]) => {
      const cy = cyRef.current;
      if (!cy || cy.nodes().length === 0) return;

      if (newNodeIds) {
        // A new-edges-only expansion skips layout entirely — falling through to a full re-fit visibly zoomed in/out during a burst of expansions.
        if (newNodeIds.length === 0) return;

        const newNodes = cy.collection();
        for (const id of newNodeIds) {
          const node = cy.getElementById(id);
          if (node.length > 0) newNodes.merge(node);
        }
        const newEdges = newNodes.connectedEdges();
        const layoutEles = newNodes.union(newEdges);

        // "preset" just applies each node's current position() (already set
        // to its deterministic slot in expand(), below) with a smooth animation. Kept short so a
        // recursive multi-node walk (each new node's own arrival triggers this) settles quickly
        // instead of visibly animating for seconds after the data's already loaded.
        const layout = layoutEles.layout({
          name: 'preset',
          animate,
          animationDuration: 180,
          fit: false,
          padding: 50,
        } as any);
        layout.run();
      } else {
        // After collapse: just fit the viewport to remaining elements.
        // Don't re-run layout — the remaining nodes are already well-positioned.
        cy.animate({ fit: { eles: cy.elements(), padding: 30 } } as any, { duration: 400 });
      }
    },
    [cyRef]
  );

  /** Expands a node: checks debounce/budget, dispatches via the registry, applies the per-expansion limit, integrates results into Cytoscape, triggers layout, updates graph state. */
  const expand = useCallback(
    async (nodeId: string, nodeType: string): Promise<ExpandOutcome> => {
      // Already expanded or resolved terminal → no-op either way.
      if (graphState.isExpanded(nodeId) || graphState.isTerminal(nodeId)) {
        return { status: 'skipped' };
      }

      if (inFlightRef.current.has(nodeId)) {
        return { status: 'skipped' };
      }

      if (!graphState.canAcceptNodes(1)) {
        setLastError(
          `Cannot expand: node budget of ${GRAPH_CONFIG.NODE_BUDGET} reached`
        );
        return { status: 'error' };
      }

      inFlightRef.current.add(nodeId);
      setIsExpanding(true);
      setLastError(null);
      setLastNotice(null);
      graphState.markLoading(nodeId);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const cy = cyRef.current;
        const nodeUri = cy?.getElementById(nodeId)?.data('uri') || nodeId;

        // Existing node URIs, for dedup in generic expansion.
        const existingNodeUris = new Set<string>();
        if (cy) {
          cy.nodes().forEach((n) => {
            const uri = n.data('uri');
            if (uri) existingNodeUris.add(uri);
          });
        }

        const expansionCtx: ExpansionContext = {
          ...context,
          nodeId,
          nodeUri,
          _existingNodeUris: existingNodeUris,
          otherRelationshipLimit: GRAPH_CONFIG.EXPANSION_SAMPLE_THRESHOLD + 1,
        };

        const resultPromise = registry.expand(nodeType, expansionCtx);

        const result: ExpansionResult = await Promise.race([
          resultPromise,
          new Promise<never>((_, reject) => {
            controller.signal.addEventListener('abort', () => {
              reject(new Error('Request timed out'));
            });
          }),
        ]);

        clearTimeout(timeoutId);

        // Surface VALUE_NODE_SPECS' panel-only values as small circles — also rescues an
        // otherwise-empty result (e.g. Geometry's own triples are all panel-only). Two parents
        // can share the same value node (they're keyed per-owner now, so rare, but a stale id
        // collision is still possible) — an already-on-canvas id becomes an edge-only addition
        // instead of being dropped entirely, so this parent's relationship isn't lost silently.
        const valueNodesToAdd: Array<{ id: string; label: string; edgeLabel: string }> = [];
        const valueEdgesToAdd: Array<{ id: string; edgeLabel: string }> = [];
        const valueSpecs = resolveValueSpecs(nodeUri, nodeType);
        if (valueSpecs) {
          const props = panelPropertiesStore.get(nodeUri) ?? [];
          for (const spec of valueSpecs) {
            const prop = props.find((p) => p.predicate === spec.predicate);
            if (!prop) continue;
            const rawValue = prop.valueType === 'uri' ? extractLocalName(prop.value) : prop.value;
            const id = spec.idFor(nodeUri, rawValue);
            if ((cy?.getElementById(id).length ?? 0) > 0) {
              valueEdgesToAdd.push({ id, edgeLabel: spec.edgeLabel });
              continue;
            }
            valueNodesToAdd.push({
              id,
              label: spec.edgeLabel === 'geo:asWKT' ? formatWktLabel(rawValue) : (rawValue.length > 50 ? rawValue.slice(0, 47) + '...' : rawValue),
              edgeLabel: spec.edgeLabel,
            });
          }
        }

        // Zero results → mark terminal, but first check reverse-direction references (e.g. a shared classification term with no outgoing triples), gated on the same sample threshold so one ordinary backlink doesn't trigger the message.
        if (result.nodes.length === 0 && valueNodesToAdd.length === 0 && valueEdgesToAdd.length === 0) {
          const incomingCount = await countIncomingRelationships(nodeUri);
          const isSignificant = incomingCount > GRAPH_CONFIG.EXPANSION_SAMPLE_THRESHOLD;
          // Genuinely nothing here: stays silent rather than an actively-annoying
          // "nothing found" toast on every ordinary terminal leaf clicked through.
          if (isSignificant) {
            setLastNotice({
              message: EXPANSION_MESSAGES.referencedButNotExpanded(incomingCount),
              type: 'warning',
            });
          }
          graphState.markTerminal(nodeId);
          return { status: 'terminal', incomingCount: isSignificant ? incomingCount : undefined };
        }

        const totalCount = result.totalCount ?? result.nodes.length;
        const truncated = result.nodes.length > perExpansionLimit;
        const limitedNodes = truncated
          ? result.nodes.slice(0, perExpansionLimit)
          : result.nodes;

        const limitedNodeIds = new Set(limitedNodes.map((n) => n.id));
        limitedNodeIds.add(nodeId); // include the source node
        const limitedEdges = truncated
          ? result.edges.filter(
              (e) => limitedNodeIds.has(e.source) && limitedNodeIds.has(e.target)
            )
          : result.edges;

        const cy2 = cyRef.current;
        if (!cy2) {
          graphState.markError(nodeId);
          setLastError('Cytoscape instance not available');
          return { status: 'error' };
        }

        // Maps real URI → existing node id — the initial render often uses a synthetic id (e.g. "class:MOUNTAIN") generic expansion would otherwise duplicate under the real URI.
        const uriToExistingId = new Map<string, string>();
        cy2.nodes().forEach((n) => {
          const uri = n.data('uri');
          if (uri) uriToExistingId.set(uri, n.id());
        });

        // Dedup filter — skip nodes/edges already present, and self-loops (never valid in RDF).
        let newNodes = limitedNodes.filter(
          n => !uriToExistingId.has(n.id) && cy2.getElementById(n.id).length === 0
        );
        let newEdges: Array<{ source: string; target: string; label: string; sharedTarget?: boolean }> = limitedEdges
          .map(e => ({ ...e, target: uriToExistingId.get(e.target) ?? e.target }))
          .filter(e => {
            if (e.source === e.target) return false;
            const edgeId = `${e.source}-${e.target}-${e.label}`;
            if (cy2.getElementById(edgeId).length > 0) return false;
            // Keep if target is new, or both endpoints already exist (a newly discovered relationship).
            const srcExists = cy2.getElementById(e.source).length > 0;
            const tgtExists = cy2.getElementById(e.target).length > 0;
            const tgtIsNew = newNodes.some(n => n.id === e.target);
            return tgtIsNew || (srcExists && tgtExists);
          })
          // A "second" (or later) edge into an already-existing node — its position was only ever
          // chosen relative to whoever reached it first, so this new connecting line has to cross
          // wherever it already sits; graphNodeStyles.ts bows these outward into open space instead
          // of a straight/default line through the graph's crowded interior.
          .map(e => ({ ...e, sharedTarget: !newNodes.some(n => n.id === e.target) }));

        // Value nodes are spliced in after the dedup filter — they were never part of result.nodes.
        for (const valueNode of valueNodesToAdd) {
          if (cy2.getElementById(valueNode.id).length > 0) continue; // race: added by a concurrent expansion
          newNodes = [...newNodes, { id: valueNode.id, label: valueNode.label, type: 'literal', uri: undefined }];
          newEdges = [...newEdges, { source: nodeId, target: valueNode.id, label: valueNode.edgeLabel }];
        }

        // This parent's own edge to a shared value node another parent already added.
        for (const valueEdge of valueEdgesToAdd) {
          if (cy2.getElementById(valueEdge.id).length === 0) continue; // vanished somehow; safety
          const edgeId = `${nodeId}-${valueEdge.id}-${valueEdge.edgeLabel}`;
          if (cy2.getElementById(edgeId).length > 0) continue; // already have this exact edge
          newEdges = [...newEdges, { source: nodeId, target: valueEdge.id, label: valueEdge.edgeLabel }];
        }

        // Nothing new after filtering (every relationship was already visible) → terminal, silent.
        if (newNodes.length === 0 && newEdges.length === 0) {
          graphState.markTerminal(nodeId);
          return { status: 'terminal' };
        }

        // Budget check for the deduplicated set
        const dedupNodesNeeded = newNodes.length + (truncated ? 1 : 0); // +1 for "show more" node
        if (!graphState.canAcceptNodes(dedupNodesNeeded)) {
          graphState.markError(nodeId);
          setLastError(
            `Cannot expand: would add ${dedupNodesNeeded} nodes but only ${graphState.remainingBudget()} slots available`
          );
          return { status: 'error' };
        }

        // Deterministic fan-out around the parent, same convention as the initial radial layout.
        const addedNodeIds: string[] = [];
        const addedEdgeIds: string[] = [];

        const parentNode = cy2.getElementById(nodeId);
        // authoritativePosition, not parentNode.position() directly — this node may be mid-flight
        // in a repositionSharedNode animation right now (e.g. this very expand() call is the
        // recursive dbltap walk revealing a just-repositioned MetaData hub's own Publisher/
        // Location), and position() during an active .animate() returns a transient in-between
        // frame, not the real destination. See pendingNodeTargets' doc comment in
        // repositionSharedNode above for the bug this avoids.
        const parentPos = parentNode.length > 0
          ? authoritativePosition(cy2, nodeId)
          : { x: 0, y: 0 };

        const edgeLabelByTarget = new Map(newEdges.map((e) => [e.target, e.label]));
        const showMoreId = `${nodeId}__show_more`;
        const fanNodes = newNodes.map((n) => ({ id: n.id, type: n.type, label: edgeLabelByTarget.get(n.id) }));
        if (truncated) fanNodes.push({ id: showMoreId, type: 'showMore', label: '…' });
        // Same adaptive spacing computeRadialLayout uses, based on the graph's about-to-be size.
        const expansionRadiusStep = adaptiveRadiusStep(cy2.nodes().length + fanNodes.length);
        // Continue outward along the same bearing this node was itself reached from (its own
        // real incoming edge(s)), instead of computeExpansionPositions' cruder origin-relative
        // fallback — see that function's doc comment for why the fallback zig-zags near the
        // graph's centre. Averages every real parent when there's more than one (a
        // repositionSharedNode-moved hub sitting between two parents), so the new branch
        // continues from wherever this node actually ended up, not just its first parent.
        let preferredDirection: number | undefined;
        if (parentNode.length > 0) {
          let sumX = 0, sumY = 0, count = 0;
          parentNode.incomers('edge').forEach((e) => {
            const src = e.source();
            if (src.id() === nodeId) return;
            const srcPos = authoritativePosition(cy2, src.id());
            sumX += parentPos.x - srcPos.x;
            sumY += parentPos.y - srcPos.y;
            count++;
          });
          if (count > 0 && (Math.abs(sumX) >= 0.01 || Math.abs(sumY) >= 0.01)) {
            preferredDirection = Math.atan2(sumY, sumX);
          }
        }
        const { positions: expansionPositions } = computeExpansionPositions(parentPos, fanNodes, expansionRadiusStep, nodeType, preferredDirection);

        cy2.batch(() => {
          for (const node of newNodes) {
            const pos = expansionPositions.get(node.id) ?? parentPos;
            cy2.add({
              group: 'nodes',
              data: {
                id: node.id,
                label: node.label,
                type: node.type,
                uri: node.uri,
              },
              position: pos,
            });
            addedNodeIds.push(node.id);
          }

          if (truncated) {
            if (cy2.getElementById(showMoreId).length === 0) {
              const pos = expansionPositions.get(showMoreId) ?? parentPos;
              cy2.add({
                group: 'nodes',
                data: {
                  id: showMoreId,
                  label: `Show more (${totalCount} total)`,
                  type: 'showMore',
                  parentNodeId: nodeId,
                  parentNodeType: nodeType,
                },
                position: pos,
              });
              addedNodeIds.push(showMoreId);

              const showMoreEdgeId = `${nodeId}-${showMoreId}-more`;
              cy2.add({
                group: 'edges',
                data: {
                  id: showMoreEdgeId,
                  source: nodeId,
                  target: showMoreId,
                  label: '…',
                  targetColor: nodeTypeEdgeColor('showMore'),
                },
              });
              addedEdgeIds.push(showMoreEdgeId);
            }
          }

          // Edges are already deduped above; target nodes were added earlier in this batch.
          for (const edge of newEdges) {
            const edgeId = `${edge.source}-${edge.target}-${edge.label}`;
            const targetType = cy2.getElementById(edge.target).data('type');
            cy2.add({
              group: 'edges',
              data: {
                id: edgeId,
                source: edge.source,
                target: edge.target,
                label: edge.label,
                targetColor: nodeTypeEdgeColor(targetType),
                sharedTarget: edge.sharedTarget ?? false,
              },
            });
            addedEdgeIds.push(edgeId);
          }
        });

        // Re-mark exact-match targets — this expansion may have revealed the next hop in a chain.
        markExactMatchNodes(cy2);

        // Any edge just added into an already-existing node means that node just gained a new
        // parent — move it (and its own already-expanded subtree) to a compromise position
        // between all its parents instead of leaving it stuck by its first one.
        const sharedTargetIds = new Set(newEdges.filter((e) => e.sharedTarget).map((e) => e.target));
        sharedTargetIds.forEach((targetId) => repositionSharedNode(cy2, targetId));

        graphState.markExpanded(nodeId, addedNodeIds, addedEdgeIds);

        if (result.otherTruncated) {
          setLastNotice({
            message: EXPANSION_MESSAGES.sampled(),
            type: 'warning',
          });
        }

        const newNodeCount = cy2.nodes().length;
        graphState.setNodeCount(newNodeCount);

        runLayout(true, addedNodeIds);

        return { status: 'expanded', truncated: result.otherTruncated };
      } catch (err: unknown) {
        clearTimeout(timeoutId);

        const errorMessage =
          err instanceof Error ? err.message : 'Expansion failed';

        graphState.markError(nodeId);
        setLastError(errorMessage);
        return { status: 'error' };
      } finally {
        inFlightRef.current.delete(nodeId);
        setIsExpanding(false);
      }
    },
    [
      registry,
      cyRef,
      graphState,
      context,
      perExpansionLimit,
      timeoutMs,
      runLayout,
    ]
  );

  /** Collapses a node: fades out and removes its elements, updates graph state, clears selection if needed. */
  const collapse = useCallback(
    (nodeId: string): void => {
      const cy = cyRef.current;
      if (!cy) return;

      const { removedNodeIds, removedEdgeIds } = graphState.collapse(nodeId);

      if (removedNodeIds.length === 0 && removedEdgeIds.length === 0) {
        return;
      }

      const selectedNodes = cy.nodes(':selected');
      selectedNodes.forEach((selNode) => {
        if (removedNodeIds.includes(selNode.id())) {
          selNode.unselect();
        }
      });

      const elementsToRemove = cy.collection();

      for (const edgeId of removedEdgeIds) {
        const edge = cy.getElementById(edgeId);
        if (edge.length > 0) {
          elementsToRemove.merge(edge);
        }
      }

      for (const nId of removedNodeIds) {
        const node = cy.getElementById(nId);
        if (node.length > 0) {
          elementsToRemove.merge(node);
        }
      }

      if (elementsToRemove.length > 0) {
        elementsToRemove.animate(
          {
            style: { opacity: 0 },
          } as any,
          {
            duration: GRAPH_CONFIG.COLLAPSE_ANIMATION_MS,
            complete: () => {
              elementsToRemove.remove();
              const newNodeCount = cy.nodes().length;
              graphState.setNodeCount(newNodeCount);
              runLayout(true);
            },
          }
        );
      }
    },
    [cyRef, graphState, runLayout]
  );

  // Resets lastNotice/lastError to null — lets a caller aggregating many expand() calls (the recursive dbltap walk) clear the state itself once it's computed its own final toast, so a late descendant's already-queued setLastNotice can't leak through after walkActiveRef flips, regardless of effect timing.
  const clearNotice = useCallback(() => {
    setLastNotice(null);
    setLastError(null);
  }, []);

  // Reads inFlightRef fresh on every call (not a snapshot captured at some earlier render) —
  // isExpanding is a single boolean that concurrent expand() calls can stomp on each other (call
  // A's own finally block flips it back to false while call B is still running), so it's not
  // reliable for "is ANYTHING still expanding right now" when several cross-border places get
  // double-tapped in quick succession, each running its own concurrent recursive walk.
  const hasInFlightExpansions = useCallback(() => inFlightRef.current.size > 0, []);

  return {
    expand,
    collapse,
    isExpanding,
    hasInFlightExpansions,
    lastError,
    lastNotice,
    clearNotice,
  };
}
