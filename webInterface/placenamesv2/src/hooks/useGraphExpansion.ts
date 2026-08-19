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
import type {
  IExpansionRegistry,
  ExpansionContext,
  ExpansionResult,
} from '../services/expansionRegistry';
import type { UseGraphStateReturn } from './useGraphState';

/** Panel-only predicates the initial render already shows as value circles — surfaced the same way during expansion (ids matching graphBuilder's own scheme) so a different chain doesn't look thinner; excludes pn:name, already the node's own label. */
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
      predicate: 'http://linked.data.gov.au/def/placenames/status',
      edgeLabel: 'pn:status',
      idFor: (_nodeUri, value) => `literal:status:${value}`,
    },
  ],
  publisher: [
    {
      predicate: 'http://xmlns.com/foaf/0.1/name',
      edgeLabel: 'foaf:name',
      idFor: (_nodeUri, value) => `literal:pub:${value}`,
    },
  ],
  location: [
    {
      predicate: 'http://www.w3.org/2004/02/skos/core#prefLabel',
      edgeLabel: 'skos:prefLabel',
      idFor: (_nodeUri, value) => `literal:loc:${value}`,
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
        // to its deterministic slot in expand(), below) with a smooth animation.
        const layout = layoutEles.layout({
          name: 'preset',
          animate,
          animationDuration: 300,
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
        // otherwise-empty result (e.g. Geometry's own triples are all panel-only).
        const valueNodesToAdd: Array<{ id: string; label: string; edgeLabel: string }> = [];
        const valueSpecs = resolveValueSpecs(nodeUri, nodeType);
        if (valueSpecs) {
          const props = panelPropertiesStore.get(nodeUri) ?? [];
          for (const spec of valueSpecs) {
            const prop = props.find((p) => p.predicate === spec.predicate);
            if (!prop) continue;
            const rawValue = prop.valueType === 'uri' ? extractLocalName(prop.value) : prop.value;
            const id = spec.idFor(nodeUri, rawValue);
            if ((cy?.getElementById(id).length ?? 0) > 0) continue; // already on canvas
            valueNodesToAdd.push({
              id,
              label: spec.edgeLabel === 'geo:asWKT' ? formatWktLabel(rawValue) : (rawValue.length > 50 ? rawValue.slice(0, 47) + '...' : rawValue),
              edgeLabel: spec.edgeLabel,
            });
          }
        }

        // Zero results → mark terminal, but first check reverse-direction references (e.g. a shared classification term with no outgoing triples), gated on the same sample threshold so one ordinary backlink doesn't trigger the message.
        if (result.nodes.length === 0 && valueNodesToAdd.length === 0) {
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
        let newEdges = limitedEdges
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
          });

        // Value nodes are spliced in after the dedup filter — they were never part of result.nodes.
        for (const valueNode of valueNodesToAdd) {
          if (cy2.getElementById(valueNode.id).length > 0) continue; // race: added by a concurrent expansion
          newNodes = [...newNodes, { id: valueNode.id, label: valueNode.label, type: 'literal', uri: undefined }];
          newEdges = [...newEdges, { source: nodeId, target: valueNode.id, label: valueNode.edgeLabel }];
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
        const parentPos = parentNode.length > 0
          ? parentNode.position()
          : { x: 0, y: 0 };

        const edgeLabelByTarget = new Map(newEdges.map((e) => [e.target, e.label]));
        const showMoreId = `${nodeId}__show_more`;
        const fanNodes = newNodes.map((n) => ({ id: n.id, type: n.type, label: edgeLabelByTarget.get(n.id) }));
        if (truncated) fanNodes.push({ id: showMoreId, type: 'showMore', label: '…' });
        // Same adaptive spacing computeRadialLayout uses, based on the graph's about-to-be size.
        const expansionRadiusStep = adaptiveRadiusStep(cy2.nodes().length + fanNodes.length);
        const { positions: expansionPositions } = computeExpansionPositions(parentPos, fanNodes, expansionRadiusStep, nodeType);

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
              },
            });
            addedEdgeIds.push(edgeId);
          }
        });

        // Re-mark exact-match targets — this expansion may have revealed the next hop in a chain.
        markExactMatchNodes(cy2);

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

  return {
    expand,
    collapse,
    isExpanding,
    lastError,
    lastNotice,
    clearNotice,
  };
}
