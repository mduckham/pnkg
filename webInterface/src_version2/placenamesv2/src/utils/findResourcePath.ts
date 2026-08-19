/** Fallback for when resolvePanelSection.ts's fast direct lookup misses a node nested deeper than it knows about — walks the generic resource tree via expandNode/partitionLinkedProperties (reused so the walk agrees with what the panel renders), cache-backed so repeat searches are free. See findResourcePathFromRoots below for the multi-root wrapper DataPanel.tsx actually calls. */

import { expandNode } from "../services/genericExpansion";
import { panelPropertiesStore } from "../services/expansionHandlers";
import { partitionLinkedProperties } from "../components/LinkedResourceSection";
import { GRAPH_CONFIG } from "../config/graphConfig";
import type { PanelProperty } from "../types/graph";

async function propertiesFor(uri: string): Promise<PanelProperty[]> {
  const cached = panelPropertiesStore.get(uri);
  if (cached) return cached;
  const classified = await expandNode(uri, new Set());
  if (classified.panelProperties.length > 0) {
    panelPropertiesStore.set(uri, classified.panelProperties);
  }
  return classified.panelProperties;
}

/** Path from `rootUri` to `targetUri` (inclusive) through the linked-resource tree, or null if unreachable within `maxDepth` hops (e.g. targetUri is a literal/classification node from an unrelated part of the graph). */
export async function findResourcePath(
  rootUri: string,
  targetUri: string,
  maxDepth: number = GRAPH_CONFIG.MAX_LINKED_RESOURCE_DEPTH,
  visited: Set<string> = new Set()
): Promise<string[] | null> {
  if (rootUri === targetUri) return [rootUri];
  if (maxDepth <= 0 || visited.has(rootUri)) return null;
  visited.add(rootUri);

  const properties = await propertiesFor(rootUri);
  const { linkedByPredicate } = partitionLinkedProperties(properties);
  const childUris = new Set<string>();
  for (const entries of linkedByPredicate.values()) {
    for (const entry of entries) childUris.add(entry.value);
  }

  // A direct (one-hop) child needs no further fetching — checked before recursing into any
  // sibling, so e.g. wasNamedBy (a direct PlaceName child) resolves instantly instead of paying
  // for real SPARQL round-trips into MetaData/Publisher/Location first just because they happen
  // to iterate earlier.
  if (childUris.has(targetUri)) return [rootUri, targetUri];

  for (const child of childUris) {
    const subPath = await findResourcePath(child, targetUri, maxDepth - 1, visited);
    if (subPath) return [rootUri, ...subPath];
  }

  return null;
}

/** Tries each root in turn, returning the first that reaches `targetUri` — needed since the resource tree now starts independently at each Name/Geometry, not just one primary root. Sequential (not parallel) so search order stays predictable and cache-backed repeat tries stay fast. */
export async function findResourcePathFromRoots(
  roots: string[],
  targetUri: string,
  maxDepth: number = GRAPH_CONFIG.MAX_LINKED_RESOURCE_DEPTH
): Promise<{ rootUri: string; path: string[] } | null> {
  for (const rootUri of roots) {
    const path = await findResourcePath(rootUri, targetUri, maxDepth, new Set());
    if (path) return { rootUri, path };
  }
  return null;
}
