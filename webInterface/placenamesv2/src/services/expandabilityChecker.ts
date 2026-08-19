/** Determines which nodes should show the expand indicator — checks cached triples locally when available, otherwise issues a SPARQL query, for a graph-visible outgoing URI object not already in the graph. */

import { querySparql } from './sparqlService';
import { getCachedTriples, hasCachedTriples } from './sparqlCache';
import { GRAPH_VISIBLE_PREDICATES } from '../config/presentationRules';

// Local alias matching this file's existing name, now sourced from presentationRules.ts (shared with genericExpansion.ts) instead of a second definition.
const graphVisiblePredicates = GRAPH_VISIBLE_PREDICATES;

/** Checks which nodes should show the expand indicator — true if a primary-graph or secondary-graph relationship exists that isn't already in the current graph. */
export async function checkExpandability(
  nodes: Array<{ id: string; uri: string | null; type: string }>,
  visibleNodeUris: Set<string>
): Promise<Map<string, boolean>> {
  const result = new Map<string, boolean>();

  // Terminal types — never expandable
  const terminalTypes = new Set(['literal', 'showMore']);

  // Separate nodes into cached and uncached for different processing
  const uncachedNodes: Array<{ id: string; uri: string; type: string }> = [];

  for (const node of nodes) {
    // Terminal types or no URI — not expandable
    if (terminalTypes.has(node.type) || !node.uri) {
      result.set(node.id, false);
      continue;
    }

    // If cached, check locally
    if (hasCachedTriples(node.uri)) {
      const triples = getCachedTriples(node.uri);
      if (triples) {
        const isExpandable = triples.some(
          (triple) =>
            triple.objectType === 'uri' &&
            graphVisiblePredicates.includes(triple.predicate) &&
            !visibleNodeUris.has(triple.object)
        );
        result.set(node.id, isExpandable);
      } else {
        result.set(node.id, false);
      }
    } else {
      uncachedNodes.push({ id: node.id, uri: node.uri, type: node.type });
    }
  }

  // For uncached nodes, issue SPARQL queries
  if (uncachedNodes.length > 0) {
    await checkUncachedExpandability(uncachedNodes, visibleNodeUris, result);
  }

  return result;
}

/** Issues a COUNT query per uncached node to check for graph-visible outgoing triples not already in the visible graph. */
async function checkUncachedExpandability(
  nodes: Array<{ id: string; uri: string; type: string }>,
  visibleNodeUris: Set<string>,
  result: Map<string, boolean>
): Promise<void> {
  // Build the FILTER clause for graph-visible predicates
  const predicateValues = graphVisiblePredicates.map((p) => `<${p}>`).join(', ');

  // Build FILTER NOT IN clause for already-visible URIs (limit to avoid query explosion)
  const visibleUriArray = Array.from(visibleNodeUris).filter((u) => u.startsWith('http'));
  const existingFilter =
    visibleUriArray.length > 0
      ? `FILTER(?o NOT IN (${visibleUriArray.map((u) => `<${u}>`).join(', ')}))`
      : '';

  // Process nodes in parallel (limited concurrency)
  const promises = nodes.map(async (node) => {
    try {
      const query = `
SELECT (COUNT(?o) AS ?graphVisibleCount) WHERE {
  <${node.uri}> ?p ?o .
  FILTER(isIRI(?o))
  FILTER(?p IN (${predicateValues}))
  ${existingFilter}
}`;

      const sparqlResult = await querySparql(query);
      const count = parseInt(
        sparqlResult.results.bindings[0]?.graphVisibleCount?.value || '0',
        10
      );
      result.set(node.id, count > 0);
    } catch {
      // Fail gracefully — hide expand indicator
      result.set(node.id, false);
    }
  });

  await Promise.all(promises);
}
