/** Expands any RDF resource by querying its outgoing triples and routing them through the Presentation Layer — one ontology-agnostic function instead of type-specific handlers. */

import type { RawTriple, ClassifiedExpansionResult } from '../types/graph';
import { querySparql } from './sparqlService';
import { getCachedTriples, cacheTriples } from './sparqlCache';
import { classifyTriples } from './presentationLayer';
import { placeNamesPresentationRules, GRAPH_VISIBLE_PREDICATES, EXACT_MATCH_PREDICATE } from '../config/presentationRules';
import { extractPredicateLabel, extractDistinguishingLocalName } from './labelExtractor';

/** Every graph-visible predicate except skos:exactMatch — exactMatch is
 *  fetched in its own always-expand-in-full bucket (see expandNode). */
const OTHER_GRAPH_VISIBLE_PREDICATES = GRAPH_VISIBLE_PREDICATES.filter((p) => p !== EXACT_MATCH_PREDICATE);

/** Safety cap on exact-match relationships — a cross-border chain is architecturally
 *  small (at most one per state/territory), so this should never actually bind. */
const EXACT_MATCH_SAFETY_LIMIT = 50;
/** Generous cap on panel-only triples, unaffected by the graph relationship sampling below. */
const PANEL_ONLY_LIMIT = 100;

/** Runs one outgoing-triples SPARQL query and converts bindings to RawTriple[] — shared by every fetch bucket below. */
async function fetchOutgoingTriples(uri: string, filterClause: string, limit: number): Promise<RawTriple[]> {
  const query = `
SELECT ?p ?o (IF(isIRI(?o), "uri", "literal") AS ?oType) (DATATYPE(?o) AS ?datatype) (LANG(?o) AS ?lang) WHERE {
  <${uri}> ?p ?o .
  ${filterClause}
}
LIMIT ${limit}`;

  const sparqlResult = await querySparql(query);
  const triples: RawTriple[] = [];

  for (const binding of sparqlResult.results.bindings) {
    const predicate = binding.p?.value;
    const object = binding.o?.value;
    const objectType = binding.oType?.value as 'uri' | 'literal' | undefined;

    if (!predicate || !object) continue;

    triples.push({
      predicate,
      object,
      objectType: objectType === 'uri' ? 'uri' : 'literal',
      datatype: binding.datatype?.value || undefined,
      lang: binding.lang?.value || undefined,
    });
  }

  return triples;
}

/** Attaches labels + dcterms:identifier (via fetchObjectLabels) to every URI-object triple in place. */
async function attachObjectLabels(triples: RawTriple[]): Promise<RawTriple[]> {
  const uriObjects = triples.filter((t) => t.objectType === 'uri').map((t) => t.object);
  if (uriObjects.length === 0) return triples;

  const infoMap = await fetchObjectLabels(uriObjects);
  for (const triple of triples) {
    if (triple.objectType === 'uri' && infoMap.has(triple.object)) {
      const info = infoMap.get(triple.object)!;
      triple.objectLabel = info.label;
      triple.objectIdentifier = info.identifier;
    }
  }
  return triples;
}

/** Expands a node's outgoing triples: omit otherRelationshipLimit for the panel's single cached LIMIT-100 query, or pass it (canvas expansion) for three buckets — exactMatch in full, others capped at limit+1 so the count itself reveals truncation, panel-only properties — bypassing the cache whenever truncated so a partial sample never reads as "nothing more to expand." */
export async function expandNode(
  uri: string,
  existingNodeUris: Set<string>,
  otherRelationshipLimit?: number
): Promise<ClassifiedExpansionResult> {
  if (otherRelationshipLimit === undefined) {
    const cached = getCachedTriples(uri);
    if (cached) {
      return classifyTriples(cached, placeNamesPresentationRules, existingNodeUris, uri);
    }

    const triples = await attachObjectLabels(await fetchOutgoingTriples(uri, '', PANEL_ONLY_LIMIT));
    cacheTriples(uri, triples);
    return classifyTriples(triples, placeNamesPresentationRules, existingNodeUris, uri);
  }

  const otherPredicateClause = OTHER_GRAPH_VISIBLE_PREDICATES.map((p) => `<${p}>`).join(', ');
  const allGraphVisibleClause = GRAPH_VISIBLE_PREDICATES.map((p) => `<${p}>`).join(', ');

  const [exactMatchTriples, otherTriplesRaw, panelTriples] = await Promise.all([
    fetchOutgoingTriples(uri, `FILTER(?p = <${EXACT_MATCH_PREDICATE}>)`, EXACT_MATCH_SAFETY_LIMIT),
    fetchOutgoingTriples(uri, `FILTER(isIRI(?o) && ?p IN (${otherPredicateClause}))`, otherRelationshipLimit),
    fetchOutgoingTriples(uri, `FILTER(?p NOT IN (${allGraphVisibleClause}))`, PANEL_ONLY_LIMIT),
  ]);

  const otherTruncated = otherTriplesRaw.length >= otherRelationshipLimit;
  const otherTriples = otherTruncated ? otherTriplesRaw.slice(0, otherRelationshipLimit - 1) : otherTriplesRaw;

  const triples = await attachObjectLabels([...exactMatchTriples, ...otherTriples, ...panelTriples]);

  if (!otherTruncated) {
    cacheTriples(uri, triples);
  }

  return { ...classifyTriples(triples, placeNamesPresentationRules, existingNodeUris, uri), otherTruncated };
}

/** Result of {@link countExpandableRelationships}. */
export interface RelationshipCounts {
  hasExactMatch: boolean;
  exactMatchCount: number;
  /** Other outgoing graph-visible relationships (every GRAPH_VISIBLE_PREDICATES entry except exactMatch). */
  otherCount: number;
}

/** Counts a node's expandable relationships split into the two buckets double-click rules key off (exactMatch in full vs. sampled others), reusing sparqlCache when available. */
export async function countExpandableRelationships(uri: string): Promise<RelationshipCounts> {
  const cached = getCachedTriples(uri);
  if (cached) {
    let exactMatchCount = 0;
    let otherCount = 0;
    for (const triple of cached) {
      if (triple.objectType !== 'uri') continue;
      if (triple.predicate === EXACT_MATCH_PREDICATE) exactMatchCount++;
      else if (OTHER_GRAPH_VISIBLE_PREDICATES.includes(triple.predicate)) otherCount++;
    }
    return { hasExactMatch: exactMatchCount > 0, exactMatchCount, otherCount };
  }

  const otherPredicateClause = OTHER_GRAPH_VISIBLE_PREDICATES.map((p) => `<${p}>`).join(', ');
  const [exactMatchCount, otherCount] = await Promise.all([
    countOutgoingTriples(uri, `FILTER(?p = <${EXACT_MATCH_PREDICATE}>)`),
    countOutgoingTriples(uri, `FILTER(?p IN (${otherPredicateClause}))`),
  ]);

  return { hasExactMatch: exactMatchCount > 0, exactMatchCount, otherCount };
}

/** Runs one SPARQL COUNT query for outgoing URI-object triples matching the given predicate filter. */
async function countOutgoingTriples(uri: string, predicateFilter: string): Promise<number> {
  const query = `
SELECT (COUNT(?o) AS ?count) WHERE {
  <${uri}> ?p ?o .
  FILTER(isIRI(?o))
  ${predicateFilter}
}`;

  const sparqlResult = await querySparql(query);
  return parseInt(sparqlResult.results.bindings[0]?.count?.value || '0', 10);
}

/** Counts other resources pointing AT this URI (the reverse direction expand() never crawls) — used only to pick an accurate terminal message, never to render incoming relationships. */
export async function countIncomingRelationships(uri: string): Promise<number> {
  const predicateClause = GRAPH_VISIBLE_PREDICATES.map((p) => `<${p}>`).join(', ');
  const query = `
SELECT (COUNT(?s) AS ?count) WHERE {
  ?s ?p <${uri}> .
  FILTER(?p IN (${predicateClause}))
}`;

  const sparqlResult = await querySparql(query);
  return parseInt(sparqlResult.results.bindings[0]?.count?.value || '0', 10);
}

/** Batch-fetches label predicates and dcterms:identifier for URIs in one query, both OPTIONAL so an identifier-only resource (e.g. a bare Place) still comes back with something useful. */
async function fetchObjectLabels(uris: string[]): Promise<Map<string, { label?: string; identifier?: string }>> {
  const infoMap = new Map<string, { label?: string; identifier?: string }>();

  if (uris.length === 0) return infoMap;

  const valuesClause = uris.map(u => `<${u}>`).join(' ');

  const query = `
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX foaf: <http://xmlns.com/foaf/0.1/>
PREFIX dcterms: <http://purl.org/dc/terms/>
PREFIX pn: <http://linked.data.gov.au/def/placenames/>

SELECT ?s ?label ?identifier WHERE {
  VALUES ?s { ${valuesClause} }
  OPTIONAL { ?s dcterms:identifier ?identifier }
  OPTIONAL {
    { ?s rdfs:label ?label . }
    UNION { ?s skos:prefLabel ?label . }
    UNION { ?s foaf:name ?label . }
    UNION { ?s dcterms:title ?label . }
    UNION { ?s pn:name ?label . }
  }
}`;

  try {
    const result = await querySparql(query);
    for (const binding of result.results.bindings) {
      const s = binding.s?.value;
      if (!s) continue;
      const label = binding.label?.value;
      const identifier = binding.identifier?.value;
      const existing = infoMap.get(s) ?? {};
      if (label && !existing.label) existing.label = label; // first found wins (query's priority order)
      if (identifier && !existing.identifier) existing.identifier = identifier;
      infoMap.set(s, existing);
    }
  } catch {
    // Fail gracefully — labels fall back to URI local names
  }

  return infoMap;
}

/** One linked resource's own class + direct properties, resolved one hop deeper than
 *  the triple that pointed to it — see resolveResourceChains. */
export interface ResolvedResourceChain {
  type?: string;
  /** Literals as-is; nested URI objects by local name except external links, which keep
   *  their full URL. datatype is carried through for date formatting elsewhere. */
  properties: Array<{ label: string; value: string; isExternalLink?: boolean; datatype?: string }>;
}

const RDF_TYPE_PREDICATE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const PNKG_NAMESPACE = 'geosensor.net/ns/pnkg';

/** Resolves a one-hop preview (rdf:type + direct properties) per URI, turning a bare local name into e.g. "Publisher (Agent) → foaf:name: ..." — deliberately one hop only, to stay a single bounded batch query. */
export async function resolveResourceChains(
  uris: string[]
): Promise<Map<string, ResolvedResourceChain>> {
  const result = new Map<string, ResolvedResourceChain>();
  const uniqueUris = Array.from(new Set(uris)).filter(Boolean);
  if (uniqueUris.length === 0) return result;

  const valuesClause = uniqueUris.map((u) => `<${u}>`).join(' ');
  const query = `
SELECT ?s ?p ?o (IF(isIRI(?o), "uri", "literal") AS ?oType) (IF(isLiteral(?o), STR(DATATYPE(?o)), "") AS ?oDatatype) WHERE {
  VALUES ?s { ${valuesClause} }
  ?s ?p ?o .
}
LIMIT 500`;

  try {
    const sparqlResult = await querySparql(query);
    for (const binding of sparqlResult.results.bindings) {
      const s = binding.s?.value;
      const p = binding.p?.value;
      const o = binding.o?.value;
      const oType = binding.oType?.value;
      const oDatatype = binding.oDatatype?.value || undefined;
      if (!s || !p || !o) continue;

      if (!result.has(s)) result.set(s, { properties: [] });
      const entry = result.get(s)!;

      if (p === RDF_TYPE_PREDICATE && oType === 'uri') {
        if (!entry.type) entry.type = o;
        continue;
      }

      const label = extractPredicateLabel(p);
      const isExternalLink = oType === 'uri' && /^https?:\/\//.test(o) && !o.includes(PNKG_NAMESPACE);
      const value = oType === 'uri' && !isExternalLink ? extractDistinguishingLocalName(o) : o;
      entry.properties.push({ label, value, isExternalLink, datatype: oType === 'literal' ? oDatatype : undefined });
    }
  } catch {
    // Fail gracefully — properties simply aren't enriched with a chain.
  }

  return result;
}
