/** Sends SPARQL queries directly to Fuseki via HTTP POST and returns the JSON results. */

import { appConfig } from "../config/appConfig";

// Simple in-memory cache for SPARQL responses (reduces repeated queries)
const queryCache = new Map<string, { data: SparqlResults; timestamp: number }>();
const CACHE_TTL_MS = 60_000; // 1 minute cache

/** Sends a SPARQL query (POST) and returns parsed results — signal lets a caller firing one request per keystroke (e.g. SearchBar's suggestions) cancel a now-superseded in-flight request. */
export async function querySparql(query: string, signal?: AbortSignal): Promise<SparqlResults> {
  const cacheKey = query.trim();
  const cached = queryCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }


  const url = `${appConfig.sparqlEndpoint}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/sparql-results+json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `query=${encodeURIComponent(query)}`,
    signal,
  });


  if (!response.ok) {
    throw new Error(`SPARQL query failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  queryCache.set(cacheKey, { data, timestamp: Date.now() });
  return data;
}

/** One row of SPARQL results — each variable (?name, ?category, ...) is a key. */
export interface SparqlBinding {
  [key: string]: {
    type: "uri" | "literal" | "typed-literal" | "bnode";
    value: string;
    datatype?: string;
    "xml:lang"?: string;
  };
}

export interface SparqlResults {
  results: {
    bindings: SparqlBinding[];
  };
}

/** Extracts a simple string value from a SPARQL binding. */
export function getValue(binding: SparqlBinding, key: string): string | undefined {
  return binding[key]?.value;
}

/** The last segment of a URI (e.g. ".../PlaceType/WATERCOURSE" → "WATERCOURSE"). */
export function getLocalName(uri: string): string {
  try {
    const url = new URL(uri);
    const fragment = url.hash ? url.hash.substring(1) : null;
    if (fragment) return decodeURIComponent(fragment);
    const path = url.pathname.split("/").pop();
    return decodeURIComponent(path || uri);
  } catch {
    return uri.split(/[/#]/).pop() || uri;
  }
}
