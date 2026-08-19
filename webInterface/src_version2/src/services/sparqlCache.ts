/** In-memory cache of a URI's outgoing triples after expansion, ontology-agnostic — reused by the expandability checker to avoid duplicate SPARQL requests. Cleared entirely on graph context change (new place loaded). */

import type { RawTriple } from '../types/graph';

/** Internal cache storage — URI → outgoing triples */
const cache = new Map<string, RawTriple[]>();

export function getCachedTriples(uri: string): RawTriple[] | null {
  return cache.get(uri) ?? null;
}

/** Overwrites any previously cached value for the same URI. */
export function cacheTriples(uri: string, triples: RawTriple[]): void {
  cache.set(uri, triples);
}

/** Called on graph context change (new place loaded via search, map, or Feel Lucky). */
export function clearCache(): void {
  cache.clear();
}

export function hasCachedTriples(uri: string): boolean {
  return cache.has(uri);
}

/** Debugging/testing aid. */
export function getCacheSize(): number {
  return cache.size;
}
