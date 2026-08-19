/** A single generic handler (using expandNode() for all node types) that adapts
 *  ClassifiedExpansionResult into the ExpansionResult shape useGraphExpansion expects. */

import { expandNode } from '../genericExpansion';
import { createExpansionRegistry } from '../expansionRegistry';
import type { ExpansionContext, ExpansionResult, IExpansionRegistry } from '../expansionRegistry';
import type { PanelProperty } from '../../types/graph';

/** After each expansion, that node's panel properties are stored here keyed by URI so the
 *  Selected Node Panel can access them. */
export const panelPropertiesStore = new Map<string, PanelProperty[]>();

/** Generic expansion handler — works for any node type via expandNode(). */
async function genericHandler(ctx: ExpansionContext): Promise<ExpansionResult> {
  const uri = ctx.nodeUri || ctx.nodeId;

  if (!uri || !uri.startsWith('http')) {
    return { nodes: [], edges: [] };
  }

  const existingNodeUris = ctx._existingNodeUris ?? new Set<string>();

  const classified = await expandNode(uri, existingNodeUris, ctx.otherRelationshipLimit);

  if (classified.panelProperties.length > 0) {
    panelPropertiesStore.set(uri, classified.panelProperties);
  }

  // Dedupe nodes by URI (same resource from multiple triples appears once), but keep all edges.
  const seenNodeUris = new Set<string>();
  const nodes: ExpansionResult['nodes'] = [];
  for (const gn of classified.graphNodes) {
    if (!seenNodeUris.has(gn.uri)) {
      seenNodeUris.add(gn.uri);
      nodes.push({
        id: gn.id,
        label: gn.label,
        type: gn.type,
        uri: gn.uri,
      });
    }
  }

  // One edge per graphNode entry, including duplicates with different edge labels.
  const edges: ExpansionResult['edges'] = classified.graphNodes.map((gn) => ({
    source: ctx.nodeId,
    target: gn.id,
    label: gn.edgeLabel,
  }));

  const totalCount = classified.totalGraphVisible ?? nodes.length;

  return {
    nodes,
    edges,
    totalCount,
    otherTruncated: classified.otherTruncated,
  };
}

/** Creates an expansion registry pre-configured with the generic handler for all known node types. */
export function createDefaultRegistry(): IExpansionRegistry {
  const registry = createExpansionRegistry();

  const nodeTypes = ['place', 'placeName', 'classification', 'geometry', 'metaData', 'resource', 'literal'];
  for (const type of nodeTypes) {
    registry.register(type, genericHandler);
  }

  return registry;
}
