/** Cytoscape.js knowledge graph canvas with progressive expansion. */

import { useRef, useEffect, useCallback, useState, useMemo, forwardRef, useImperativeHandle } from "react";
import cytoscape from "cytoscape";
import type { Core, EventObject } from "cytoscape";
import type { GraphData, GraphNode } from "../types/graph";
import { createDefaultRegistry } from "../services/expansionHandlers";
import { countExpandableRelationships } from "../services/genericExpansion";
import { clearCache } from "../services/sparqlCache";
import { useGraphState } from "../hooks/useGraphState";
import type { NodeExpansionState } from "../hooks/useGraphState";
import { useGraphExpansion } from "../hooks/useGraphExpansion";
import type { ExpandOutcome } from "../hooks/useGraphExpansion";
import { checkExpandability } from "../services/expandabilityChecker";
import { computeRadialLayout, type LayoutPosition, estimateLabelWidth } from "../services/graphLayout";
import { markExactMatchNodes, EXACT_MATCH_CLASS } from "../utils/exactMatch";
import { getCytoscapeStyles, nodeBaseSize, NODE_GLOW_COLORS, PANEL_HIGHLIGHT_COLORS, EDGE_LABEL_FONT_SIZE } from "../services/graphNodeStyles";
import { checkNodeOverlap } from "../utils/checkNodeOverlap";
import type { SelectedGraphNode } from "../hooks/useSelectedGraphNode";
import { ToastNotification } from "./ToastNotification";
import { ContextMenu } from "./ContextMenu";
import { GRAPH_CONFIG, EXPANSION_MESSAGES } from "../config/graphConfig";
import { appConfig, nodeTypeEdgeColor } from "../config/appConfig";

interface GraphPanelProps {
  data: GraphData | null;
  placeName: string;
  /** The place URI for expansion queries */
  placeUri?: string;
  /** The geometry URI for expansion queries */
  geometryUri?: string;
  /** The placeName URI for expansion queries */
  placeNameUri?: string;
  onNodeClick?: (node: GraphNode) => void;
  isLocked?: boolean;
  onToggleLock?: () => void;
  /** Whether the initial SPARQL response is still loading */
  isLoading?: boolean;
  /** Node IDs to highlight from external panel interaction */
  highlightNodeIds?: string[];
  /** Callback for "I Feel Lucky" button — picks a random interesting place */
  onFeelLucky?: () => void;
  /** Resets the map to show all of the current place's geometries at once — search/click leave it zoomed close to a single point by default. */
  onResetMapView?: () => void;
  /** Opens the Nearby Places panel for the currently selected place */
  onViewNearby?: () => void;
  /** Currently selected node's id (lifted to the caller via useSelectedGraphNode) — used only to clear selection if the collapsed node was the selected one. */
  selectedNodeId?: string | null;
  /** Reports node selection changes up to the caller — null on
   *  deselect/background-tap/graph-context-change. */
  onNodeSelect?: (node: SelectedGraphNode | null) => void;
}

/** Ref handle so callers outside the canvas (e.g. Cross-border expand-in-place) can trigger a node's double-click expansion. */
export interface GraphPanelRef {
  /** No-op if the node isn't currently on the canvas. */
  expandNodeByUri(uri: string): void;
}

// Node types that never expand — literals/showMore have nothing to fetch.
const NON_EXPANDABLE_TYPES = new Set(['literal', 'showMore']);

// Fraction of the panel the graph fills on fit — kept a hair under 1.0 so a node's border/glow ring never clips.
const FIT_FILL_FRACTION = 0.99;

/** Zooms/pans so the graph fills FIT_FILL_FRACTION of the container, instead of cy.fit()'s flat-pixel padding. */
function fitToPanel(cy: Core) {
  const container = cy.container();
  const bb = cy.elements().boundingBox();
  if (!container || !isFinite(bb.w) || !isFinite(bb.h) || bb.w === 0 || bb.h === 0) {
    cy.fit(undefined, 30);
    return;
  }
  const zoom = Math.min(container.clientWidth / bb.w, container.clientHeight / bb.h) * FIT_FILL_FRACTION;
  cy.zoom(zoom);
  cy.center(cy.elements());
}

/** Gap reserved around an edge label's obstacle circle (smaller than a node's own GAP below). */
const LABEL_OBSTACLE_GAP = 16;

/** Circumscribing-circle radius for a rotated edge label's text footprint (half-diagonal, not just half-width, so it covers any edge angle). */
function labelObstacleRadius(label: string | undefined): number {
  const halfW = estimateLabelWidth(label) / 2;
  const halfH = EDGE_LABEL_FONT_SIZE / 2;
  return Math.hypot(halfW, halfH) + LABEL_OBSTACLE_GAP;
}

/** After an expansion, pushes each new node outward from its own local anchor (not the graph origin) just far enough to clear existing nodes and edge labels, without moving anything pre-existing. */
function resolveNewSubtreeOverlaps(cy: Core, preExistingIds: Set<string>) {
  const newIds = cy.nodes().filter((n) => !preExistingIds.has(n.id())).map((n) => n.id());
  if (newIds.length === 0) return;
  const newIdSet = new Set(newIds);

  // Obstacles: existing nodes + existing edges' labels; grows as each new node resolves.
  const obstacles: Array<{ x: number; y: number; r: number }> = [];
  cy.nodes().forEach((n) => {
    if (!newIdSet.has(n.id())) {
      obstacles.push({ x: n.position('x'), y: n.position('y'), r: nodeBaseSize(n.data('type')) / 2 });
    }
  });
  cy.edges().forEach((e) => {
    if (preExistingIds.has(e.source().id()) && preExistingIds.has(e.target().id())) {
      const sx = e.source().position('x'), sy = e.source().position('y');
      const tx = e.target().position('x'), ty = e.target().position('y');
      obstacles.push({ x: (sx + tx) / 2, y: (sy + ty) / 2, r: labelObstacleRadius(e.data('label')) });
    }
  });

  // Gap kept generous so a new node reads as clearly separate, not just non-overlapping.
  const GAP = 40;

  // Closest-to-centre nodes resolve first — pushing one further out can
  // only ever help a node already further out clear it, never the reverse.
  const ordered = [...newIds].sort((a, b) => {
    const na = cy.getElementById(a), nb = cy.getElementById(b);
    return Math.hypot(na.position('x'), na.position('y')) - Math.hypot(nb.position('x'), nb.position('y'));
  });

  // Nodes with a settled final position — used to find each new node's local anchor.
  const fixedIds = new Set(preExistingIds);

  for (const id of ordered) {
    const node = cy.getElementById(id);
    const connected = node.connectedEdges();

    // Local anchor: the already-fixed node this one is attached to (deterministic tie-break on ties).
    const anchorSlot: { value: { x: number; y: number } | null; id: string | null } = { value: null, id: null };
    connected.forEach((e) => {
      const other = e.source().id() === id ? e.target() : e.source();
      if (other.id() !== id && fixedIds.has(other.id())) {
        if (anchorSlot.id === null || other.id() < anchorSlot.id) {
          anchorSlot.value = { x: other.position('x'), y: other.position('y') };
          anchorSlot.id = other.id();
        }
      }
    });
    const anchor = anchorSlot.value;
    // Falls back to origin-relative angle if a new node somehow has no fixed neighbour.
    const angle = anchor
      ? Math.atan2(node.position('y') - anchor.y, node.position('x') - anchor.x)
      : Math.atan2(node.position('y'), node.position('x'));

    const r = nodeBaseSize(node.data('type')) / 2;
    let x = node.position('x');
    let y = node.position('y');
    let pushed = true;
    let iterations = 0;
    while (pushed && iterations < 30) {
      pushed = false;
      iterations++;
      for (const obs of obstacles) {
        const dist = Math.hypot(x - obs.x, y - obs.y);
        const needed = r + obs.r + GAP;
        if (dist < needed) {
          const extra = (needed - dist) + 5;
          x += extra * Math.cos(angle);
          y += extra * Math.sin(angle);
          pushed = true;
          break;
        }
      }
    }
    if (x !== node.position('x') || y !== node.position('y')) {
      node.animate({ position: { x, y } } as any, { duration: 400 });
    }
    obstacles.push({ x, y, r });
    fixedIds.add(id);

    // Edges to already-fixed neighbours now have a settled label position — add as an obstacle.
    connected.forEach((e) => {
      const other = e.source().id() === id ? e.target() : e.source();
      if (other.id() !== id && fixedIds.has(other.id())) {
        obstacles.push({ x: (x + other.position('x')) / 2, y: (y + other.position('y')) / 2, r: labelObstacleRadius(e.data('label')) });
      }
    });
  }

  setTimeout(() => {
    checkNodeOverlap(cy);
    fitToPanel(cy);
  }, 450);
}

export const GraphPanel = forwardRef<GraphPanelRef, GraphPanelProps>(function GraphPanel({
  data,
  placeName,
  placeUri,
  geometryUri,
  placeNameUri,
  onNodeClick,
  isLocked = false,
  onToggleLock,
  isLoading = false,
  highlightNodeIds,
  onFeelLucky,
  onResetMapView,
  onViewNearby,
  selectedNodeId = null,
  onNodeSelect,
}: GraphPanelProps, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  useImperativeHandle(ref, () => ({
    expandNodeByUri: (uri: string) => {
      const cy = cyRef.current;
      if (!cy) return;
      // Re-emits 'dbltap' so it runs through the real double-click handler below.
      // Retries briefly since a nested cross-border node may not be on the canvas yet.
      const tryExpand = (attemptsLeft: number) => {
        const node = cy.nodes().filter((n) => n.data("uri") === uri);
        if (node.length > 0) {
          node.emit("dbltap");
          return;
        }
        if (attemptsLeft > 0) setTimeout(() => tryExpand(attemptsLeft - 1), 400);
      };
      tryExpand(8); // ~3.2s of retrying before giving up silently
    },
  }), []);
  const layoutRunningRef = useRef(false);
  // Last computed radial-tree positions, reused when re-adding literal nodes (scissors toggle).
  const lastLayoutPositionsRef = useRef<Map<string, LayoutPosition>>(new Map());
  const onNodeClickRef = useRef(onNodeClick);
  const onNodeSelectRef = useRef(onNodeSelect);
  // Hides a literal node instantly on add while the scissors toggle is simplified.
  const literalsVisibleRef = useRef(true);
  // Lets hover-tooltip handlers read current expansion state without re-running that effect.
  const expansionMapRef = useRef<Map<string, NodeExpansionState>>(new Map());
  // True right after a canvas tap/dbltap — lets the selectedNodeId effect skip re-panning to a node already in view.
  const selectionFromCanvasRef = useRef(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "warning" | "error" } | null>(null);
  const [errorNodes, setErrorNodes] = useState<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [hoverTooltip, setHoverTooltip] = useState<{ x: number; y: number; html: string } | null>(null);
  onNodeClickRef.current = onNodeClick;
  onNodeSelectRef.current = onNodeSelect;

  // Instantiate the expansion registry (stable across renders)
  const registry = useMemo(() => createDefaultRegistry(), []);

  // Graph state management hook
  const graphState = useGraphState();

  // Expansion context built from props
  const expansionContext = useMemo(() => ({
    nodeId: "",
    placeUri,
    geometryUri,
    placeNameUri,
  }), [placeUri, geometryUri, placeNameUri]);

  // Graph expansion hook — orchestrates expand/collapse workflows
  const { expand, collapse, lastError, lastNotice, clearNotice } = useGraphExpansion({
    registry,
    cyRef,
    graphState,
    context: expansionContext,
  });

  const collapseRef = useRef(collapse);
  useEffect(() => { collapseRef.current = collapse; }, [collapse]);

  const expandRef = useRef(expand);
  useEffect(() => { expandRef.current = expand; }, [expand]);

  // True while a dbltap recursive walk is in flight, so the toast effects below don't
  // fire per-descendant and instead let the walk's own aggregate toast win.
  const walkActiveRef = useRef(false);

  // Show toast when lastError changes (failed expansion)
  useEffect(() => {
    if (lastError && !walkActiveRef.current) {
      setToast({ message: lastError, type: "error" });
    }
  }, [lastError]);

  // Show toast when lastNotice changes (sampling / dead-end expansion feedback)
  useEffect(() => {
    if (lastNotice && !walkActiveRef.current) {
      setToast({ message: lastNotice.message, type: lastNotice.type });
    }
  }, [lastNotice]);

  // Keep the ref in sync for the hover-tooltip handlers (see expansionMapRef above)
  useEffect(() => {
    expansionMapRef.current = graphState.expansionMap;
  }, [graphState.expansionMap]);

  // Apply error styling to nodes and auto-dismiss after 8 seconds
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    for (const [nodeId, state] of graphState.expansionMap.entries()) {
      const node = cy.getElementById(nodeId);
      if (state.status === "error" && node.length > 0) {
        node.addClass("error-node");
        // Set up auto-dismiss if not already set
        if (!errorNodes.has(nodeId)) {
          const timeout = setTimeout(() => {
            node.removeClass("error-node");
            setErrorNodes((prev) => {
              const next = new Map(prev);
              next.delete(nodeId);
              return next;
            });
          }, GRAPH_CONFIG.ERROR_DISMISS_MS);
          setErrorNodes((prev) => new Map(prev).set(nodeId, timeout));
        }
      }
    }
  }, [graphState.expansionMap, errorNodes]);

  // Toggle edge labels based on edgeLabelsVisible from graph state
  // V1 style has labels visible by default but still respect the toggle
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    if (graphState.edgeLabelsVisible) {
        cy.edges().removeStyle("label");
    } else {
        cy.edges().style("label", "");
    }
  }, [graphState.edgeLabelsVisible]);


  // SPARQL-based expandability: stores URI → has hidden relationships (boolean)
  const expandabilityMapRef = useRef<Map<string, boolean>>(new Map());
  const [expandabilityVersion, setExpandabilityVersion] = useState(0);

  // Fetch expandability data — only for types that can meaningfully expand
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !data || data.nodes.length === 0) return;

    const nodeInfos: Array<{ id: string; uri: string | null; type: string }> = [];
    const visibleIds = new Set<string>();

    cy.nodes().forEach((node) => {
      const nodeId = node.id();
      const uri = node.data("uri") || null;
      const nodeType = node.data("type") || "literal";

      visibleIds.add(nodeId);
      if (uri) visibleIds.add(uri);

      // Only check expandability for types that CAN expand.
      if (!NON_EXPANDABLE_TYPES.has(nodeType) && uri) {
        nodeInfos.push({ id: nodeId, uri, type: nodeType });
      }
    });

    if (nodeInfos.length === 0) return;

    checkExpandability(nodeInfos, visibleIds).then((hasHiddenMap) => {
      expandabilityMapRef.current = hasHiddenMap;
      setExpandabilityVersion((v) => v + 1);
    });
  }, [data, graphState.expansionMap]);

  // Update expandable node visual indicators — only for expandable types
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    const hasHiddenMap = expandabilityMapRef.current;

    cy.nodes().forEach((node) => {
      const nodeId = node.id();
      const nodeUri = node.data("uri");
      const nodeType = node.data("type");
      const state = graphState.expansionMap.get(nodeId);

      // Non-expandable types or already expanded/terminal — never show indicator.
      if (
        !nodeUri ||
        NON_EXPANDABLE_TYPES.has(nodeType) ||
        state?.status === "expanded" ||
        state?.status === "terminal"
      ) {
        node.removeClass("expandable-node");
        return;
      }

      const hasHidden = hasHiddenMap.get(nodeUri);
      if (hasHidden === true) {
        node.addClass("expandable-node");
      } else {
        node.removeClass("expandable-node");
      }
    });
  }, [graphState.expansionMap, expandabilityVersion]);

  // Track previous lock state for unlock transitions
  const prevLockedRef = useRef(isLocked);

  // Highlight nodes from external panel interaction
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    // Restore previously highlighted nodes to their base size before applying new ones
    cy.nodes('.panel-highlight').forEach((node) => {
      if (node.removed()) return;
      const nodeType: string = node.data('type') || 'literal';
      const base = nodeBaseSize(nodeType);
      node.stop(true);
      node.style({
        width: base,
        height: base,
        'border-width': 2,
      });
    });
    cy.nodes().removeClass('panel-highlight');

    // Apply new highlights — match by ID, URI, or label
    if (highlightNodeIds && highlightNodeIds.length > 0) {
      for (const nodeId of highlightNodeIds) {
        // Try exact ID match first
        let node = cy.getElementById(nodeId);
        // Fallback: search by uri data property
        if (node.length === 0) {
          node = cy.nodes().filter((n) => n.data('uri') === nodeId);
        }
        // Fallback: search by label or fullLabel (for nodes with synthetic IDs like Publisher/Location)
        if (node.length === 0) {
          node = cy.nodes().filter((n) => {
            const label = n.data('fullLabel') || n.data('label') || '';
            return label === nodeId || label.includes(nodeId) || nodeId.includes(label);
          });
        }
        if (node.length > 0) {
          node.addClass('panel-highlight');
          const nodeType: string = node.data('type') || 'literal';
          const base = nodeBaseSize(nodeType);
          // PANEL_HIGHLIGHT_COLORS, not plain NODE_GLOW_COLORS — for pale types (literal grey, metaData olive) the glow colour equals the resting border, making the highlight nearly invisible.
          const glowColor = PANEL_HIGHLIGHT_COLORS[nodeType] ?? NODE_GLOW_COLORS[nodeType] ?? '#616161';
          node.style({
            width: Math.round(base * 1.3),
            height: Math.round(base * 1.3),
            'border-width': 6,
            'border-color': glowColor,
          });
        }
      }
    }
  }, [highlightNodeIds]);

  // Syncs canvas selection with the externally-selected node (panel picks, search, KG nav).
  // Skips the pan/animate step for a canvas-originated selection (node's already in view).
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.nodes(':selected').unselect();
    if (!selectedNodeId) return;
    const node = cy.getElementById(selectedNodeId);
    if (node.length === 0) return;
    node.select();
    if (selectionFromCanvasRef.current) {
      selectionFromCanvasRef.current = false;
    } else {
      cy.animate({ center: { eles: node } } as any, { duration: 300 });
    }
  }, [selectedNodeId]);

  // Destructure stable values so useEffect dep arrays contain plain variables (not member access)
  const { literalsVisible, edgeLabelsVisible, reset: resetGraph, setNodeCount: setGraphNodeCount } = graphState;

  // Shows/hides literal nodes via a style class (not remove/re-add), so it also
  // covers literals added later by expansion, not just the initial render.
  useEffect(() => {
    literalsVisibleRef.current = literalsVisible;
    const cy = cyRef.current;
    if (!cy) return;

    // 'resource' nodes are leaf value-ish entities too — hide alongside plain literals.
    const literals = cy.nodes('[type="literal"], [type="resource"]');
    if (!literalsVisible) {
      literals.addClass('value-hidden');
      literals.connectedEdges().addClass('value-hidden');
      cy.edges().style('label', '');
    } else {
      cy.elements('.value-hidden').removeClass('value-hidden');
      if (edgeLabelsVisible) {
        cy.edges().removeStyle('label');
      }
    }
  }, [literalsVisible, edgeLabelsVisible]);

  // Whether double-clicking this node could plausibly reveal something new — gates the hover hint.
  function hasSomethingToExplore(node: ReturnType<Core['getElementById']>, nodeType: string): boolean {
    const state = expansionMapRef.current.get(node.id());
    if (state?.status === 'expanded' || state?.status === 'terminal') return false;
    if (node.hasClass('expandable-node')) return true;
    if (nodeType === 'geometry' || nodeType === 'placeName') return true;
    if (nodeType === 'metaData') {
      const uri = node.data('uri') as string | undefined;
      return !!uri && (uri.includes('/Publisher/') || uri.includes('/Location/'));
    }
    return false;
  }

  // Initialize Cytoscape instance once (event handlers only)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // ResizeObserver for graph container — zoom follows panel resizing
    let resizeObserver: ResizeObserver | null = null;
    let resizeDebounceTimer: ReturnType<typeof setTimeout> | null = null;

    if (!cyRef.current) {
      cyRef.current = cytoscape({
        container,
        elements: [],
        style: getCytoscapeStyles(),
        minZoom: 0.2,
        maxZoom: 4,
      });

      // Single tap on node — select it (always shows the details panel below)
      cyRef.current.on("tap", "node", (evt: EventObject) => {
        const node = evt.target;
        const nodeData = node.data();
        if (!nodeData) return;
        // Handle "show more" node click — no-op in static graph
        if (nodeData.type === "showMore") return;

        selectionFromCanvasRef.current = true;
        onNodeSelectRef.current?.({ id: nodeData.id, label: nodeData.fullLabel || nodeData.label, type: nodeData.type, uri: nodeData.uri ?? null });
        if (onNodeClickRef.current) {
          onNodeClickRef.current({
            id: nodeData.id,
            label: nodeData.fullLabel || nodeData.label || "",
            type: nodeData.type || "literal",
            x: node.position().x,
            y: node.position().y,
            radius: 25,
          });
        }
        // Geometry node click also shows its shape on the map.
        if (nodeData.type === "geometry") {
          const geoUri = nodeData.uri || nodeData.id;
          window.dispatchEvent(new CustomEvent('graph:geometrySelect', { detail: { geometryUri: geoUri } }));
        }
        // Every node type with a real URI expands on single click, except exact-match
        // nodes (double-click-only, so they don't pull in another place's subgraph unexpectedly).
        if (nodeData.uri && nodeData.type !== "literal" && nodeData.type !== "showMore" && !node.hasClass(EXACT_MATCH_CLASS)) {
          const cy = cyRef.current;
          if (cy) {
            // Snapshot so resolveNewSubtreeOverlaps only ever moves what this expansion adds.
            const preExistingIds = new Set(cy.nodes().map((n: any) => n.id()));
            expandRef.current(nodeData.id, nodeData.type).then(() => resolveNewSubtreeOverlaps(cy, preExistingIds));
          }
        }
      });

      // Tap on background clears selection and context menu
      cyRef.current.on("tap", (evt: EventObject) => {
        if (evt.target === cyRef.current) {
          onNodeSelectRef.current?.(null);
          setContextMenu(null);
        }
      });

      // Double-tap recursively expands a node's entire subtree, stopping at each
      // exact-match place boundary (added as a stub, not auto-expanded further).
      cyRef.current.on("dbltap", "node", (evt: EventObject) => {
        const node = evt.target;
        const nodeData = node.data();
        if (!nodeData || !nodeData.id) return;

        // Reused below to decide exact-match-specific toast wording.
        const isExactMatchNode = node.hasClass(EXACT_MATCH_CLASS);
        const countsPromise = nodeData.uri
          ? countExpandableRelationships(nodeData.uri).catch(() => null)
          : Promise.resolve(null);

        selectionFromCanvasRef.current = true;
        onNodeSelectRef.current?.({ id: nodeData.id, label: nodeData.fullLabel || nodeData.label, type: nodeData.type, uri: nodeData.uri ?? null });

        if (nodeData.uri && nodeData.type !== 'literal' && nodeData.type !== 'showMore') {
          const cy = cyRef.current;
          if (cy) {
            // Snapshot before the walk starts, so resolveNewSubtreeOverlaps never moves pre-existing nodes.
            const preExistingIds = new Set(cy.nodes().map((n: any) => n.id()));
            const attempted = new Set<string>();
            // Collected across the whole walk, not lastNotice/lastError (only the most recent call), so a deep leaf's routine "nothing further" can't clobber an earlier real notice.
            const outcomes: ExpandOutcome[] = [];
            let rootOutcome: ExpandOutcome | undefined;
            walkActiveRef.current = true;
            const expandRecursively = async (id: string, type: string, isRoot = false): Promise<void> => {
              if (attempted.has(id)) return;
              attempted.add(id);
              const beforeIds = new Set(cy.nodes().map((n: any) => n.id()));
              const outcome = await expandRef.current(id, type);
              outcomes.push(outcome);
              if (isRoot) rootOutcome = outcome;
              const justAdded = cy.nodes().filter((n: any) => !beforeIds.has(n.id()));
              const toRecurse: Array<{ id: string; type: string }> = [];
              justAdded.forEach((n: any) => {
                const d = n.data();
                // Stop at exact-match boundaries — added, but not queued for its own recursion.
                if (d.uri && d.type !== 'literal' && d.type !== 'showMore' && !attempted.has(d.id) && !n.hasClass(EXACT_MATCH_CLASS)) {
                  toRecurse.push({ id: d.id, type: d.type });
                }
              });
              await Promise.all(toRecurse.map((n) => expandRecursively(n.id, n.type)));
            };
            Promise.all([expandRecursively(nodeData.id, nodeData.type, true), countsPromise]).then(([, rootCounts]) => {
              resolveNewSubtreeOverlaps(cy, preExistingIds);
              // The one toast for the whole walk — clearNotice() wipes any descendant's leftover message before flipping walkActiveRef, so a late-processed one can never win the race.
              clearNotice();
              walkActiveRef.current = false;
              const anyError = outcomes.some((o) => o.status === 'error');
              const anyTruncated = outcomes.some((o) => o.truncated);
              if (anyError) {
                setToast({ message: 'Some relationships could not be expanded — please try again', type: 'error' });
              } else if (anyTruncated) {
                setToast({ message: EXPANSION_MESSAGES.sampled(), type: 'warning' });
              } else if (isExactMatchNode && rootCounts && !rootCounts.hasExactMatch) {
                setToast({ message: EXPANSION_MESSAGES.NO_EXACT_MATCHES, type: 'warning' });
              } else if (rootOutcome?.status === 'terminal' && rootOutcome.incomingCount) {
                setToast({
                  message: EXPANSION_MESSAGES.referencedButNotExpanded(rootOutcome.incomingCount),
                  type: 'warning',
                });
              } else {
                setToast(null);
              }
            });
          }
        }
      });

      // Keep newly-added literal nodes/edges in sync with the current scissors state.
      cyRef.current.on('add', (evt: EventObject) => {
        if (literalsVisibleRef.current) return; // nothing to hide right now
        const ele = evt.target;
        const isValueType = (t: string) => t === 'literal' || t === 'resource';
        if (ele.isNode() && isValueType(ele.data('type'))) {
          ele.addClass('value-hidden');
        } else if (ele.isEdge()) {
          const srcType = ele.source().data('type');
          const tgtType = ele.target().data('type');
          if (isValueType(srcType) || isValueType(tgtType)) {
            ele.addClass('value-hidden');
          }
        }
      });

      // Right-click (cxttap) on a node — show context menu for collapse
      cyRef.current.on("cxttap", "node", (evt: EventObject) => {
        const nodeData = evt.target.data();
        if (nodeData && nodeData.id) {
          const renderedPos = evt.renderedPosition || evt.target.renderedPosition();
          setContextMenu({
            x: renderedPos.x,
            y: renderedPos.y,
            nodeId: nodeData.id,
          });
        }
      });

      // Hover tooltip for geometry nodes — show connected place list
      cyRef.current.on('mouseover', 'node[type="geometry"]', (evt: EventObject) => {
        const node = evt.target;
        const renderedPos = (evt as any).renderedPosition || node.renderedPosition();
        const connectedPlaces = node.neighborhood('node[type="place"]');
        const names: string[] = [];
        connectedPlaces.forEach((p: any) => {
          const d = p.data();
          names.push(d.fullLabel || d.label || d.id);
        });
        const placesText = `${names.length} place${names.length === 1 ? '' : 's'}${names.length > 0 ? ': ' + names.slice(0,6).join(', ') : ''}`;
        const html = hasSomethingToExplore(node, 'geometry') ? `${placesText} · 👆 Click to explore` : placesText;
        setHoverTooltip({ x: renderedPos.x, y: renderedPos.y, html });
      });

      cyRef.current.on('mouseout', 'node[type="geometry"]', () => {
        setHoverTooltip(null);
      });

      // Hover hint for every other entity node — geometry has its own tooltip above;
      // literal/showMore aren't interactive.
      cyRef.current.on('mouseover', 'node', (evt: EventObject) => {
        const node = evt.target;
        const nodeData = node.data();
        const nodeType = nodeData.type;
        if (nodeType === 'geometry' || nodeType === 'literal' || nodeType === 'showMore') return;
        const renderedPos = (evt as any).renderedPosition || node.renderedPosition();
        // Exact-match nodes expand on double-click only — say so explicitly.
        const html = node.hasClass(EXACT_MATCH_CLASS)
          ? '👆 Click to see details · Double-click to explore'
          : !nodeData.uri
            ? '👆 Click to see details'
            : hasSomethingToExplore(node, nodeType)
              ? '👆 Click to see details & explore'
              : '👆 Click to see details';
        setHoverTooltip({ x: renderedPos.x, y: renderedPos.y, html });
      });

      cyRef.current.on('mouseout', 'node', (evt: EventObject) => {
        const nodeData = evt.target.data();
        if (nodeData.type === 'geometry') return; // handled by the geometry-specific mouseout above
        setHoverTooltip(null);
      });

      // ── Direct style hover: enlarge + thick coloured border on mouseover ──
      cyRef.current.on('mouseover', 'node', (evt: EventObject) => {
        const node = evt.target;
        if (node.removed()) return;
        if (node.selected()) return;
        const nodeType: string = node.data('type') || 'literal';
        const base = nodeBaseSize(nodeType);
        const glowColor = NODE_GLOW_COLORS[nodeType] ?? '#888888';
        node.style({
          width: Math.round(base * 1.15),
          height: Math.round(base * 1.15),
          'border-width': 5,
          'border-color': glowColor,
        });
      });

      cyRef.current.on('mouseout', 'node', (evt: EventObject) => {
        const node = evt.target;
        if (node.removed()) return;
        if (node.selected()) return;
        node.removeStyle('width height border-width border-color');
      });

      // ── Direct style selection: stronger emphasis + larger size ──
      cyRef.current.on('select', 'node', (evt: EventObject) => {
        const node = evt.target;
        if (node.removed()) return;
        const nodeType: string = node.data('type') || 'literal';
        const base = nodeBaseSize(nodeType);
        const glowColor = NODE_GLOW_COLORS[nodeType] ?? '#888888';
        node.style({
          width: Math.round(base * 1.1),
          height: Math.round(base * 1.1),
          'border-width': 4,
          'border-color': glowColor,
        });
      });

      cyRef.current.on('unselect', 'node', (evt: EventObject) => {
        const node = evt.target;
        if (node.removed()) return;
        node.removeStyle('width height border-width border-color');
      });
    }
    // Keyboard shortcuts for the graph container
    const handleKeyDown = (ev: KeyboardEvent) => {
      const cy = cyRef.current;
      if (!cy) return;
      const selected = cy.nodes(':selected');
      if (ev.key === ' ' || ev.key === 'Spacebar') {
        ev.preventDefault();
        // Expansion disabled — spacebar is a no-op
      }
      if (ev.key.toLowerCase() === 'c') {
        // Collapse selected
        if (selected.length > 0) {
          collapseRef.current(selected[0].id());
        }
      }
    };

    container.addEventListener('keydown', handleKeyDown);

    // Set up ResizeObserver after Cytoscape is initialized
    if (cyRef.current) {
      resizeObserver = new ResizeObserver(() => {
        if (resizeDebounceTimer) clearTimeout(resizeDebounceTimer);
        resizeDebounceTimer = setTimeout(() => {
          const cy = cyRef.current;
          if (cy) {
            cy.resize();
            fitToPanel(cy);
          }
        }, 200);
      });
      resizeObserver.observe(container);
    }

    return () => {
      // Destroy on unmount
      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
      }
      if (resizeDebounceTimer) {
        clearTimeout(resizeDebounceTimer);
      }
      if (cyRef.current) {
        cyRef.current.destroy();
        cyRef.current = null;
      }
      container.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Track what data was last rendered to avoid unnecessary rebuilds on unlock
  const lastRenderedDataIdRef = useRef<string | null>(null);

  // Render initial graph when data changes (respects lock state)
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    // While locked, retain all expansion state regardless of data changes
    if (isLocked) return;

    // Compute a simple identity for the current data to detect actual changes
    const dataId = data ? `${data.nodes.length}:${data.edges.length}:${data.nodes[0]?.id || ''}` : null;

    // If data hasn't actually changed (e.g., just unlocked), don't rebuild
    if (dataId === lastRenderedDataIdRef.current && cy.nodes().length > 0) return;
    lastRenderedDataIdRef.current = dataId;

    cy.elements().remove();
    resetGraph(); // Reset expansion state for new place
    clearCache(); // Clear SPARQL expansion cache on graph context change
    onNodeSelectRef.current?.(null); // Clear Selected Node Panel on graph context change

    if (!data || data.nodes.length === 0) {
      cy.resize();
      return;
    }

    // Deterministic radial-tree layout — roots are place nodes nothing else points to.
    const rootIds = data.nodes
      .filter((n) => n.type === 'place' && !data.edges.some((e) => e.target === n.id))
      .map((n) => n.id);
    const { positions: layoutPositions } = computeRadialLayout(data.nodes, data.edges, rootIds);
    lastLayoutPositionsRef.current = layoutPositions;

    // Add nodes with duplicate prevention — using the computed radial positions
    for (const node of data.nodes) {
      // Skip literal/value nodes if simplified view is enabled
      if ((node.type === 'literal' || node.type === 'resource') && !literalsVisible) continue;
      if (cy.getElementById(node.id).length === 0) {
        const pos = layoutPositions.get(node.id) ?? { x: 0, y: 0 };
        cy.add({
          data: {
            id: node.id,
            // Untruncated — the stylesheet's per-type label functions handle wrap/truncate for canvas display.
            label: node.label,
            type: node.type,
            fullLabel: node.fullLabel ?? node.label,
            uri: node.uri,
          },
          position: pos,
        });
      }
    }

    // Add edges with composite key deduplication
    for (const edge of data.edges) {
      // Skip edges that involve literal/resource nodes when values are hidden
      const srcNode = data.nodes.find((n) => n.id === edge.source);
      const tgtNode = data.nodes.find((n) => n.id === edge.target);
      const isValueType = (t: string) => t === 'literal' || t === 'resource';
      if ((!srcNode || !tgtNode) || ((!literalsVisible) && (isValueType(srcNode.type) || isValueType(tgtNode.type)))) {
        continue;
      }
      const edgeId = `${edge.source}-${edge.target}-${edge.label}`;
      if (cy.getElementById(edgeId).length === 0) {
        cy.add({
          data: {
            id: edgeId,
            source: edge.source,
            target: edge.target,
            label: edge.label,
            targetColor: nodeTypeEdgeColor(tgtNode.type),
          },
        });
      }
    }

    // Track initial node count in graph state
    setGraphNodeCount(cy.nodes().length);

    // Mark nodes that are targets of skos:exactMatch edges with double-circle
    markExactMatchNodes(cy);

    // "preset" applies the radial-tree positions already set above, with a fit/pan animation.
    const layoutPadding = cy.nodes().length <= 10 ? 30 : 60;
    cy.resize();
    layoutRunningRef.current = true;
    const layout = cy.layout({
      name: "preset",
      animate: true,
      animationDuration: 400,
      fit: true,
      padding: layoutPadding,
    } as any);
    layout.on("layoutstop", () => {
      layoutRunningRef.current = false;
      fitToPanel(cy);
      checkNodeOverlap(cy);
    });
    layout.run();
  }, [data, isLocked, resetGraph, literalsVisible, setGraphNodeCount]);

  // Handle unlock transition: just update the ref, don't rebuild.
  // The graph stays as-is until new data arrives (next place selection).
  useEffect(() => {
    prevLockedRef.current = isLocked;
  }, [isLocked]);

  // Handle collapse via context menu — delegates to useGraphExpansion hook
  const handleCollapse = useCallback((nodeId: string) => {
    collapse(nodeId);
    // Clear selection if collapsed node was selected
    if (selectedNodeId === nodeId) onNodeSelect?.(null);
    setContextMenu(null);
  }, [collapse, selectedNodeId, onNodeSelect]);

  const handleFit = useCallback(() => {
    if (cyRef.current) {
      cyRef.current.resize();
      // Plain fit(), no zoom floor — the ⟳ button means "show me everything
      // that's on the canvas," which shouldn't be second-guessed by a floor.
      cyRef.current.fit(undefined, GRAPH_CONFIG.FIT_PADDING_PX);
    }
  }, []);

  const hasData = data && data.nodes.length > 0;

  return (
    <div className={`h-full w-full flex flex-col ${isLocked ? "ring-2 ring-amber-200 ring-inset" : ""}`}>
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-gray-200 bg-gray-50 flex items-center justify-between shrink-0 max-h-12 overflow-hidden">
        <div>
          <h2 className="text-sm font-semibold text-gray-700">
            Knowledge Graph
            {isLocked && <span className="ml-1.5 text-[10px] text-amber-600 font-normal">(locked)</span>}
          </h2>
          {/* isLoading gates before placeName — placeName holds the previous place's name until new data is ready. */}
          {isLoading && !isLocked
            ? <p className="text-[11px] text-gray-400">Loading…</p>
            : placeName
              ? <p className="text-[11px] text-gray-500">Showing relationships for: <span className="font-medium text-gray-700">{placeName}</span></p>
              : <p className="text-[11px] text-gray-400">Select a place to explore</p>
          }
        </div>
        <div className="flex gap-1">
          {onToggleLock && (
            <button
              onClick={onToggleLock}
              className={`w-7 h-7 flex items-center justify-center rounded border text-xs transition-colors ${
                isLocked ? "bg-amber-100 border-amber-300 text-amber-700" : "bg-white border-gray-200 text-gray-500 hover:bg-gray-50"
              }`}
              title={isLocked ? "Unlock — graph will update when you select places on the map" : "Lock — freeze graph so it stays while you explore the map"}
              aria-label={isLocked ? "Unlock knowledge graph" : "Lock knowledge graph"}
              aria-pressed={isLocked}
            >
              {isLocked ? "🔒" : "🔓"}
            </button>
          )}
          {/* Simplify view: hide literal/value nodes */}
          <button
            onClick={() => {
              if (graphState.toggleLiteralsVisible) graphState.toggleLiteralsVisible();
              // If edge labels are visible, hide them when simplifying
              if (graphState.edgeLabelsVisible && graphState.toggleEdgeLabels) graphState.toggleEdgeLabels();
            }}
            className={`w-7 h-7 flex items-center justify-center rounded border text-xs transition-colors bg-white border-gray-200 text-gray-500 hover:bg-gray-50 ${
              !graphState.literalsVisible ? 'ring-1 ring-amber-200' : ''
            }`}
            title={graphState.literalsVisible ? 'Simplify view (hide values)' : 'Show values'}
            aria-pressed={!graphState.literalsVisible}
          >
            ✂️
          </button>
          {hasData && (
            <button onClick={handleFit} className="w-7 h-7 flex items-center justify-center rounded bg-white border border-gray-200 text-gray-500 text-xs hover:bg-gray-50" title="Fit graph to view">⟳</button>
          )}
          {hasData && onResetMapView && (
            <button
              onClick={onResetMapView}
              className="w-7 h-7 flex items-center justify-center rounded bg-white border border-gray-200 text-gray-500 hover:bg-gray-50"
              title="Zoom map out to show all geometries"
              aria-label="Zoom map out to show all geometries"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 9V5a1 1 0 011-1h4M20 9V5a1 1 0 00-1-1h-4M4 15v4a1 1 0 001 1h4M20 15v4a1 1 0 01-1 1h-4" />
              </svg>
            </button>
          )}
          {hasData && onViewNearby && (
            <button
              onClick={onViewNearby}
              className="w-7 h-7 flex items-center justify-center rounded bg-white border border-gray-200 text-gray-500 text-xs hover:bg-gray-50"
              title="Nearby places"
              aria-label="Nearby places"
            >
              📍
            </button>
          )}
        </div>
      </div>

      {/* Graph container */}
      <div className="flex-1 min-h-0 min-w-0 relative bg-gray-50">
        {/* The REAL Cytoscape canvas — kept mounted always (destroying/
            recreating it would lose the live cy instance), but genuinely
            hidden (not just covered by something on top) while isLoading,
            via visibility rather than a translucent overlay: a decorative
            layer painted OVER a still-rendered canvas can never fully rule
            out the old graph bleeding through underneath it, which is
            exactly what looked broken before. Skipped while locked — a
            locked graph is frozen on purpose and must stay visible
            regardless of what the live selection is doing. */}
        <div
          ref={containerRef}
          style={{
            width: "100%", height: "100%", position: "absolute", top: 0, left: 0,
            visibility: isLoading && !isLocked ? "hidden" : "visible",
          }}
        />

        {/* Hover tooltip — horizontally centered on the node by default, but
            clamped near the panel's left/right edges so the (nowrap) text
            can't run off-canvas and get truncated, which it previously did
            for nodes near the right edge of the graph panel. */}
        {hoverTooltip && (() => {
          const containerWidth = containerRef.current?.clientWidth ?? 0;
          const EDGE_MARGIN = 160; // rough max tooltip half-width
          let translateX = '-50%';
          let left = hoverTooltip.x;
          if (containerWidth > 0 && hoverTooltip.x > containerWidth - EDGE_MARGIN) {
            translateX = '-100%';
            left = Math.min(hoverTooltip.x + 12, containerWidth - 4);
          } else if (hoverTooltip.x < EDGE_MARGIN) {
            translateX = '0%';
            left = Math.max(hoverTooltip.x - 12, 4);
          }
          return (
            <div
              className="absolute z-30 pointer-events-none text-xs bg-gray-900 text-white px-2 py-1 rounded shadow"
              style={{
                left,
                top: hoverTooltip.y,
                transform: `translate(${translateX}, -140%)`,
                whiteSpace: 'nowrap',
              }}
            >
              {hoverTooltip.html}
            </div>
          );
        })()}

        {/* Loading state — shown while the graph for the current selection
            is loading (see App.tsx's activeSelectionGeometryUri). Fully
            OPAQUE and paired with hiding the real canvas above (not a
            translucent decoration on top of it): a fake "skeleton graph"
            here would just be a different-looking thing sitting on top of
            the same still-rendered old canvas, which was the actual
            complaint — this only ever needs to communicate "loading,"
            never impersonate graph content that isn't there yet. */}
        {isLoading && !isLocked && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-50 z-20">
            <div className="flex flex-col items-center gap-2">
              <div className="w-8 h-8 border-3 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
              <p className="text-xs text-gray-500">Loading knowledge graph…</p>
            </div>
          </div>
        )}

        {/* Empty state — no graph data */}
        {!hasData && !isLoading && (
          <div className="absolute inset-0 flex items-center justify-center text-center px-6 bg-gray-50 z-10">
            <div>
              <span className="text-4xl mb-4 block">🗺️</span>
              <p className="text-sm text-gray-600 font-medium">Select a place on the map or search for a place</p>
              <p className="text-xs text-gray-400 mt-1">to explore its knowledge graph relationships</p>
              {onFeelLucky && (
                <button onClick={onFeelLucky} className="mt-4 px-4 py-2 text-sm bg-amber-100 text-amber-800 rounded-lg hover:bg-amber-200 transition-colors border border-amber-200">
                  🎲 I Feel Lucky
                </button>
              )}
            </div>
          </div>
        )}

        {/* Toast notification for expansion feedback — no explicit duration:
            ToastNotification scales it to the message's own length (see its
            readingDuration()), so a short notice still dismisses quickly
            and a long, information-dense one (e.g. "More than N
            relationships found...") stays up long enough to actually read. */}
        {toast && (
          <ToastNotification
            message={toast.message}
            type={toast.type}
            onDismiss={() => setToast(null)}
          />
        )}

        {/* Context menu for collapse action */}
        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            nodeId={contextMenu.nodeId}
            isExpanded={graphState.isExpanded(contextMenu.nodeId)}
            onCollapse={handleCollapse}
            onClose={() => setContextMenu(null)}
          />
        )}
      </div>


      {/* Legend — reads straight from appConfig.nodeTypes so it can never
          drift out of sync with the actual node colours or the Place
          Information panel's identity dots (same config, both places). */}
      <div className="flex items-center gap-3 px-4 py-2 border-t border-gray-200 bg-white text-[10px] flex-wrap shrink-0">
        {(["place", "placeName", "classification", "geometry", "metaData", "literal"] as const).map((type) => (
          <div key={type} className="flex items-center gap-1">
            <span
              className="w-2.5 h-2.5 rounded-full border"
              style={{ backgroundColor: appConfig.nodeTypes[type].color, borderColor: appConfig.nodeTypes[type].borderColor }}
            />
            <span className="text-gray-600">{appConfig.nodeTypes[type].label}</span>
          </div>
        ))}
      </div>
    </div>
  );
});
