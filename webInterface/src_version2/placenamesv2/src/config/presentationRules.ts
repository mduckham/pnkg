/** How SPARQL triples are classified for display — primary/secondary-graph or panel-only — evaluated in order, first match wins, defaultMode otherwise. */

// ─── Types ──────────────────────────────────────────────────────────────────

/** How a relationship should be displayed */
export type DisplayMode = 'primary-graph' | 'secondary-graph' | 'panel-only';

/** A single presentation rule */
export interface PresentationRule {
  /** Display mode for matching triples */
  mode: DisplayMode;
  /** Optional category for structured grouping (e.g., "primary", "secondary", "metadata") */
  category?: string;
  /** Optional human-readable display name override for the predicate */
  displayName?: string;
}

/** Rule matching entry */
export interface PresentationRuleEntry {
  /** Match by predicate URI */
  predicate?: string;
  /** Match by target rdf:type URI */
  targetType?: string;
  /** The rule to apply when matched */
  rule: PresentationRule;
}

/** Complete presentation rules configuration */
export interface PresentationRulesConfig {
  /** Default strategy for predicates not explicitly listed */
  defaultMode: DisplayMode;
  /** Ordered rules — first match wins */
  rules: PresentationRuleEntry[];
  /** Label predicates used for resolving node display names (priority order) */
  labelPredicates: string[];
}

// ─── PlaceNames Instance ────────────────────────────────────────────────────

/** skos:exactMatch — the one relationship type expansion always shows in full, however
 *  many there are. Named once here instead of duplicated as a bare string elsewhere. */
export const EXACT_MATCH_PREDICATE = 'http://www.w3.org/2004/02/skos/core#exactMatch';

export const placeNamesPresentationRules: PresentationRulesConfig = {
  defaultMode: 'panel-only',

  labelPredicates: [
    'http://www.w3.org/2000/01/rdf-schema#label',
    'http://www.w3.org/2004/02/skos/core#prefLabel',
    'http://xmlns.com/foaf/0.1/name',
    'http://purl.org/dc/terms/title',
    'https://schema.org/name',
  ],

  rules: [
    // --- Panel-only: literal-producing / descriptive predicates ---
    { predicate: 'http://linked.data.gov.au/def/placenames/name', rule: { mode: 'panel-only', category: 'identity' } },
    { predicate: 'http://linked.data.gov.au/def/placenames/dateGazetted', rule: { mode: 'panel-only', category: 'metadata' } },
    { predicate: 'http://linked.data.gov.au/def/placenames/isIndigenous', rule: { mode: 'panel-only', category: 'identity' } },
    { predicate: 'http://linked.data.gov.au/def/placenames/status', rule: { mode: 'panel-only', category: 'status' } },
    { predicate: 'http://www.opengis.net/ont/geosparql#asWKT', rule: { mode: 'panel-only', category: 'geometry' } },
    // --- rdf:type → panel-only ONLY (never produces graph nodes) ---
    { predicate: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type', rule: { mode: 'panel-only', category: 'system' } },
    { predicate: 'http://purl.org/dc/terms/identifier', rule: { mode: 'panel-only', category: 'identity' } },

    // Primary-graph: core relationships always shown — displayName must exactly match graphBuilder.ts's own edge labels, or dedup renders the same edge twice.
    { predicate: 'http://linked.data.gov.au/def/placenames/hasPlaceName', rule: { mode: 'primary-graph', category: 'primary', displayName: 'pn:hasPlaceName' } },
    { predicate: 'http://linked.data.gov.au/def/placenames/hasPlaceClassification', rule: { mode: 'primary-graph', category: 'primary', displayName: 'pn:hasPlaceClassification' } },
    { predicate: 'http://www.opengis.net/ont/geosparql#hasGeometry', rule: { mode: 'primary-graph', category: 'primary', displayName: 'geo:hasGeometry' } },
    // secondary-graph (not panel-only): resolves to the MetaData resource, so clicking a
    // PlaceName reveals it as a real node to keep drilling into Publisher/Location.
    { predicate: 'http://linked.data.gov.au/def/loci#isMemberOf', rule: { mode: 'secondary-graph', category: 'metadata', displayName: 'loci:isMemberOf' } },
    { predicate: EXACT_MATCH_PREDICATE, rule: { mode: 'primary-graph', category: 'primary', displayName: 'skos:exactMatch' } },

    // --- Secondary-graph: important but secondary relationships ---
    { predicate: 'http://purl.org/dc/terms/publisher', rule: { mode: 'secondary-graph', category: 'secondary', displayName: 'dcterms:publisher' } },
    { predicate: 'http://purl.org/dc/terms/spatial', rule: { mode: 'secondary-graph', category: 'secondary', displayName: 'dcterms:spatial' } },
    { predicate: 'http://linked.data.gov.au/def/placenames/wasNamedBy', rule: { mode: 'secondary-graph', category: 'secondary', displayName: 'pn:wasNamedBy' } },

    // --- Panel-only: shown in the details panel when you click the node, never as a graph circle ---
    { predicate: 'http://linked.data.gov.au/def/fsdf/hasCustodian', rule: { mode: 'panel-only', category: 'metadata', displayName: 'fsdf:hasCustodian' } },

    // --- Panel-only: MetaData secondary properties ---
    { predicate: 'http://linked.data.gov.au/def/fsdf/hasJurisdiction', rule: { mode: 'panel-only', category: 'metadata' } },
    { predicate: 'http://www.w3.org/ns/dcat#contactPoint', rule: { mode: 'panel-only', category: 'metadata' } },
    { predicate: 'http://www.w3.org/ns/dcat#distribution', rule: { mode: 'panel-only', category: 'metadata' } },
    { predicate: 'http://www.w3.org/ns/dqv#hasQualityMeasurement', rule: { mode: 'panel-only', category: 'metadata' } },
    { predicate: 'http://www.w3.org/ns/dcat#landingPage', rule: { mode: 'panel-only', category: 'metadata' } },
    { predicate: 'http://purl.org/dc/terms/description', rule: { mode: 'panel-only', category: 'metadata' } },
    { predicate: 'http://purl.org/dc/terms/issued', rule: { mode: 'panel-only', category: 'metadata' } },
  ],
};

/** Every predicate whose outgoing URI objects can become graph nodes on expansion — single
 *  source of truth for expandabilityChecker.ts and genericExpansion.ts's "other" bucket. */
export const GRAPH_VISIBLE_PREDICATES: string[] = placeNamesPresentationRules.rules
  .filter((entry) => entry.predicate && (entry.rule.mode === 'primary-graph' || entry.rule.mode === 'secondary-graph'))
  .map((entry) => entry.predicate!);
