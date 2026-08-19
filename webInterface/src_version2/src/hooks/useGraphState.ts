import { useState, useCallback } from 'react';
import { GRAPH_CONFIG } from '../config/graphConfig';

/** Per-node expansion state tracked by the graph state hook. */
export interface NodeExpansionState {
  status: 'unexplored' | 'expanded' | 'loading' | 'error' | 'terminal';
  childNodeIds: string[];
  childEdgeIds: string[];
  loadedCount: number;
  totalAvailable?: number;
}

/** Return type for the useGraphState hook. */
export interface UseGraphStateReturn {
  expansionMap: Map<string, NodeExpansionState>;
  nodeCount: number;
  edgeLabelsVisible: boolean;
  literalsVisible: boolean;
  toggleLiteralsVisible(): void;
  toggleEdgeLabels(): void;
  
  markExpanded(nodeId: string, childNodeIds: string[], childEdgeIds: string[]): void;
  markLoading(nodeId: string): void;
  markError(nodeId: string): void;
  markTerminal(nodeId: string): void;
  markUnexplored(nodeId: string): void;
  collapse(nodeId: string): { removedNodeIds: string[]; removedEdgeIds: string[] };
  isExpanded(nodeId: string): boolean;
  isTerminal(nodeId: string): boolean;
  canAcceptNodes(count: number): boolean;
  remainingBudget(): number;
  reset(): void;
  setNodeCount(count: number): void;
}

/** Creates an initial unexplored expansion state entry. */
function createUnexploredState(): NodeExpansionState {
  return {
    status: 'unexplored',
    childNodeIds: [],
    childEdgeIds: [],
    loadedCount: 0,
  };
}

/** Collects all descendant node IDs reachable by following expansion children recursively. */
function getDescendantNodeIds(
  nodeId: string,
  map: Map<string, NodeExpansionState>
): Set<string> {
  const descendants = new Set<string>();
  const stack = [nodeId];

  while (stack.length > 0) {
    const current = stack.pop()!;
    const state = map.get(current);
    if (!state || state.status === 'unexplored') continue;

    for (const childId of state.childNodeIds) {
      if (!descendants.has(childId)) {
        descendants.add(childId);
        stack.push(childId);
      }
    }
  }

  return descendants;
}

/** Node IDs "shared" — reachable from an expanded node other than the one being collapsed (or its descendants). */
function getSharedNodeIds(
  collapsingNodeId: string,
  descendantsToRemove: Set<string>,
  map: Map<string, NodeExpansionState>
): Set<string> {
  const shared = new Set<string>();

  for (const [parentId, state] of map.entries()) {
    // Skip the node being collapsed, its descendants, and non-expanded nodes
    if (
      parentId === collapsingNodeId ||
      descendantsToRemove.has(parentId) ||
      state.status !== 'expanded'
    ) {
      continue;
    }

    for (const childId of state.childNodeIds) {
      if (descendantsToRemove.has(childId)) {
        shared.add(childId);
      }
    }
  }

  return shared;
}

/** Edge IDs owned by a node and its descendants to remove — edges to shared nodes from non-collapsing parents are retained. */
function getRemovableEdgeIds(
  nodeId: string,
  descendantsToRemove: Set<string>,
  map: Map<string, NodeExpansionState>
): Set<string> {
  const removableEdges = new Set<string>();
  const nodesToProcess = new Set([nodeId, ...descendantsToRemove]);

  for (const currentId of nodesToProcess) {
    const state = map.get(currentId);
    if (!state) continue;

    for (const edgeId of state.childEdgeIds) {
      removableEdges.add(edgeId);
    }
  }

  return removableEdges;
}

/** Manages expansion state, node budget tracking, and edge label visibility for the graph. */
export function useGraphState(): UseGraphStateReturn {
  const [expansionMap, setExpansionMap] = useState<Map<string, NodeExpansionState>>(
    () => new Map()
  );
  const [nodeCount, setNodeCount] = useState(0);
  const [edgeLabelsVisible, setEdgeLabelsVisible] = useState(true);
  const [literalsVisible, setLiteralsVisible] = useState(true);

  /** Updates edge label visibility based on the current node count. */
  const updateEdgeLabelsVisibility = useCallback((count: number) => {
    setEdgeLabelsVisible(count <= GRAPH_CONFIG.EDGE_LABEL_THRESHOLD);
  }, []);

  /** Marks a node as expanded with the given child node and edge IDs. */
  const markExpanded = useCallback(
    (nodeId: string, childNodeIds: string[], childEdgeIds: string[]) => {
      setExpansionMap((prev) => {
        const next = new Map(prev);
        const existing = next.get(nodeId);
        next.set(nodeId, {
          status: 'expanded',
          childNodeIds,
          childEdgeIds,
          loadedCount: existing?.loadedCount
            ? existing.loadedCount + childNodeIds.length
            : childNodeIds.length,
          totalAvailable: existing?.totalAvailable,
        });
        return next;
      });
    },
    []
  );

  /** Marks a node as loading (expansion query in progress). */
  const markLoading = useCallback((nodeId: string) => {
    setExpansionMap((prev) => {
      const next = new Map(prev);
      const existing = next.get(nodeId) || createUnexploredState();
      next.set(nodeId, { ...existing, status: 'loading' });
      return next;
    });
  }, []);

  /** Marks a node as having encountered an error during expansion. */
  const markError = useCallback((nodeId: string) => {
    setExpansionMap((prev) => {
      const next = new Map(prev);
      const existing = next.get(nodeId) || createUnexploredState();
      next.set(nodeId, { ...existing, status: 'error' });
      return next;
    });
  }, []);

  /** Marks a node as terminal (no further relationships to expand). */
  const markTerminal = useCallback((nodeId: string) => {
    setExpansionMap((prev) => {
      const next = new Map(prev);
      const existing = next.get(nodeId) || createUnexploredState();
      next.set(nodeId, { ...existing, status: 'terminal' });
      return next;
    });
  }, []);

  /** Resets a node back to unexplored so it can be expanded again — used when the scissors toggle removes expanded children. */
  const markUnexplored = useCallback((nodeId: string) => {
    setExpansionMap((prev) => {
      const next = new Map(prev);
      next.delete(nodeId);
      return next;
    });
  }, []);

  /** Collapses a node: recursively removes descendant expansions, returning removed node/edge IDs — shared nodes reachable through another branch are retained. */
  const collapse = useCallback(
    (nodeId: string): { removedNodeIds: string[]; removedEdgeIds: string[] } => {
      let removedNodeIds: string[] = [];
      let removedEdgeIds: string[] = [];

      setExpansionMap((prev) => {
        const next = new Map(prev);
        const state = next.get(nodeId);

        if (!state || (state.status !== 'expanded' && state.status !== 'loading')) {
          return prev;
        }

        const descendantsToRemove = getDescendantNodeIds(nodeId, next);
        const sharedNodeIds = getSharedNodeIds(nodeId, descendantsToRemove, next);
        const edgesToRemove = getRemovableEdgeIds(nodeId, descendantsToRemove, next);

        const actualRemovedNodes = [...descendantsToRemove].filter(
          (id) => !sharedNodeIds.has(id)
        );

        removedNodeIds = actualRemovedNodes;
        removedEdgeIds = [...edgesToRemove];

        for (const descendantId of descendantsToRemove) {
          if (!sharedNodeIds.has(descendantId)) {
            next.delete(descendantId);
          }
        }

        next.set(nodeId, createUnexploredState());

        return next;
      });

      return { removedNodeIds, removedEdgeIds };
    },
    []
  );

  /** Returns true if the node is in the 'expanded' state. */
  const isExpanded = useCallback(
    (nodeId: string): boolean => {
      const state = expansionMap.get(nodeId);
      return state?.status === 'expanded';
    },
    [expansionMap]
  );

  /** True once resolved terminal — checked alongside isExpanded by expand()'s guard so a repeat click doesn't re-run the query and re-show the same toast. */
  const isTerminal = useCallback(
    (nodeId: string): boolean => {
      const state = expansionMap.get(nodeId);
      return state?.status === 'terminal';
    },
    [expansionMap]
  );

  /** Returns true if adding `count` nodes would not exceed the node budget. */
  const canAcceptNodes = useCallback(
    (count: number): boolean => {
      return nodeCount + count <= GRAPH_CONFIG.NODE_BUDGET;
    },
    [nodeCount]
  );

  /** Number of additional nodes that can be added before reaching the node budget. */
  const remainingBudget = useCallback((): number => {
    return Math.max(0, GRAPH_CONFIG.NODE_BUDGET - nodeCount);
  }, [nodeCount]);

  /** Resets all expansion state and node count. */
  const reset = useCallback(() => {
    setExpansionMap(new Map());
    setNodeCount(0);
    setEdgeLabelsVisible(true);
  }, []);

  /** Updates the node count and adjusts edge label visibility accordingly. */
  const handleSetNodeCount = useCallback(
    (count: number) => {
      setNodeCount(count);
      updateEdgeLabelsVisibility(count);
    },
    [updateEdgeLabelsVisibility]
  );

  const toggleEdgeLabels = useCallback(() => {
    setEdgeLabelsVisible((v) => !v);
  }, []);

  const toggleLiteralsVisible = useCallback(() => {
    setLiteralsVisible((v) => !v);
  }, []);

  return {
    expansionMap,
    nodeCount,
    edgeLabelsVisible,
    literalsVisible,
    toggleLiteralsVisible,
    toggleEdgeLabels,
    markExpanded,
    markLoading,
    markError,
    markTerminal,
    markUnexplored,
    collapse,
    isExpanded,
    isTerminal,
    canAcceptNodes,
    remainingBudget,
    reset,
    setNodeCount: handleSetNodeCount,
  };
}
