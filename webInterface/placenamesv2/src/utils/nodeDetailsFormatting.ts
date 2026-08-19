import type { PanelProperty } from "../types/graph";
import {
  extractLocalName,
  extractDistinguishingLocalName,
  extractPredicateLabel,
  deriveResourceKindFromUri,
  humanizeLocalName,
  isMetaDataHubType,
} from "../services/labelExtractor";

type ResolvedProperty = { label: string; value: string; isExternalLink?: boolean };

/** Predicate labels that identify a resource by name/title. Shared by NodeDetailBody's
 *  chain rendering and deriveResourceTitle below so they can't disagree on what's "a name." */
export const LABEL_LIKE_KEYS = new Set([
  'foaf:name',
  'skos:prefLabel',
  'rdfs:label',
  'dcterms:title',
  'vcard:organization-name',
  'schema:name',
]);

/** The subset of LABEL_LIKE_KEYS naming the resource itself (a title) rather than a person/org filling a role. */
const RESOURCE_TITLE_KEYS = new Set(['dcterms:title', 'rdfs:label']);

/** Foundational RDF classes too generic to work as a category label — a short, standard
 *  list, not app-specific terms; any domain-specific rdf:type is trusted and used directly. */
const TOO_GENERIC_TYPES = new Set([
  'http://xmlns.com/foaf/0.1/Agent',
  'http://www.w3.org/2000/01/rdf-schema#Resource',
  'http://www.w3.org/2002/07/owl#Thing',
  'http://www.w3.org/2004/02/skos/core#Concept',
  'http://www.w3.org/ns/prov#Entity',
  'http://www.w3.org/ns/prov#Agent',
]);

/** Derives a human-friendly, fully generic title for a linked resource (never raw ontology notation) — priority: Metadata hub name, then humanized rdf:type, own title/label, URI-encoded kind, any LABEL_LIKE property, finally the predicate reached through. */
export function deriveResourceTitle(
  uri: string,
  predicate: string,
  resolvedType?: string,
  resolvedProperties?: ResolvedProperty[]
): string {
  if (isMetaDataHubType(resolvedType)) return 'Metadata';

  if (resolvedType && !TOO_GENERIC_TYPES.has(resolvedType)) {
    const humanized = humanizeLocalName(extractLocalName(resolvedType));
    if (humanized) return humanized;
  }

  const ownTitle = resolvedProperties?.find((rp) => RESOURCE_TITLE_KEYS.has(rp.label));
  if (ownTitle && ownTitle.value.trim().length > 0) return ownTitle.value.trim();

  const kindFromUri = deriveResourceKindFromUri(uri);
  if (kindFromUri) return kindFromUri;

  const ownName = resolvedProperties?.find((rp) => LABEL_LIKE_KEYS.has(rp.label));
  if (ownName && ownName.value.trim().length > 0) return ownName.value.trim();

  return humanizeLocalName(extractLocalName(predicate)) || extractPredicateLabel(predicate);
}

/** Derives an at-a-glance summary next to a section's title (which Publisher, which Authority) — prefers the resource's own declared name, then its URI's local name, matching graphBuilder.ts's own node label. */
export function deriveResourceSummary(
  title: string,
  uri: string,
  resolvedProperties?: ResolvedProperty[]
): string | undefined {
  const ownName = resolvedProperties?.find((rp) => LABEL_LIKE_KEYS.has(rp.label));
  if (ownName && ownName.value.trim().length > 0 && ownName.value.trim() !== title) {
    return ownName.value.trim();
  }

  // humanizeLocalName here matters for cases with no better signal — e.g. a raw
  // PascalCase local name like "PlaceNameDatasetDistribution" would otherwise show as-is.
  const fromUri = humanizeLocalName(extractDistinguishingLocalName(uri));
  if (fromUri && fromUri !== title) return fromUri;

  return undefined;
}

/** Titles a group of resources reached via the same predicate, appending each one's distinguishing local name only on a real title collision (e.g. 5x QualityMeasurement). */
export function titleResourceGroup(
  predicate: string,
  entries: Array<{ value: string; resolvedType?: string; resolvedProperties?: ResolvedProperty[] }>
): Array<{ value: string; title: string; summary?: string }> {
  const titled = entries.map((e) => ({
    value: e.value,
    title: deriveResourceTitle(e.value, predicate, e.resolvedType, e.resolvedProperties),
    resolvedProperties: e.resolvedProperties,
  }));
  const counts = new Map<string, number>();
  for (const t of titled) counts.set(t.title, (counts.get(t.title) ?? 0) + 1);
  return titled.map((t) => {
    const title = (counts.get(t.title) ?? 0) > 1 ? `${t.title} (${humanizeLocalName(extractDistinguishingLocalName(t.value))})` : t.title;
    return { value: t.value, title, summary: deriveResourceSummary(title, t.value, t.resolvedProperties) };
  });
}

/** Derives a human-readable ontology name from an rdf:type URI by namespace prefix — works
 *  for any knowledge graph with no configuration changes. Undefined for unrecognised namespaces. */
export function deriveOntologyLabel(typeUri: string): string | undefined {
  // Ordered from most-specific to most-general so longer prefixes match first
  const NAMESPACE_MAP: Array<[string, string]> = [
    // PNKG domain ontologies
    ['http://linked.data.gov.au/def/placenames/', 'Australian Placenames Ontology'],
    ['http://pid.geoscience.gov.au/def/voc/ga/', 'GA PlaceType Vocabulary'],
    // Spatial / geo
    ['http://www.opengis.net/ont/geosparql#', 'GeoSPARQL Ontology'],
    ['http://www.opengis.net/ont/sf#', 'OGC Simple Features'],
    // Linked data / dataset
    ['http://www.w3.org/ns/dcat#', 'DCAT'],
    ['http://purl.org/dc/terms/', 'Dublin Core Terms'],
    ['http://purl.org/dc/elements/1.1/', 'Dublin Core'],
    ['http://rdfs.org/ns/void#', 'VoID'],
    ['http://www.w3.org/ns/prov#', 'PROV-O'],
    // Knowledge organisation
    ['http://www.w3.org/2004/02/skos/core#', 'SKOS'],
    // Social / agent
    ['http://xmlns.com/foaf/0.1/', 'FOAF'],
    ['http://schema.org/', 'Schema.org'],
    ['https://schema.org/', 'Schema.org'],
    // Core RDF/OWL/RDFS
    ['http://www.w3.org/2002/07/owl#', 'OWL'],
    ['http://www.w3.org/2000/01/rdf-schema#', 'RDFS'],
    ['http://www.w3.org/1999/02/22-rdf-syntax-ns#', 'RDF'],
  ];

  for (const [prefix, label] of NAMESPACE_MAP) {
    if (typeUri.startsWith(prefix)) return label;
  }

  // Unknown namespace — show it raw so users can see the source.
  const hashIdx = typeUri.lastIndexOf('#');
  const slashIdx = typeUri.lastIndexOf('/');
  const nsEnd = Math.max(hashIdx, slashIdx);
  if (nsEnd > 8) {
    return typeUri.slice(0, nsEnd + 1);
  }

  return undefined;
}

/** Formats an xsd:date/dateTime as plain YYYY-MM-DD by slicing the ISO prefix directly, avoiding toLocaleDateString()'s locale ambiguity and a Date round-trip's midnight-offset risk. */
export function formatDateValue(value: string): string {
  const isoPrefix = /^\d{4}-\d{2}-\d{2}/.exec(value);
  if (isoPrefix) return isoPrefix[0];
  const parsed = new Date(value);
  if (isNaN(parsed.getTime())) return value;
  return parsed.toISOString().slice(0, 10);
}

/** Formats a panel property value by XSD datatype: dates → YYYY-MM-DD, booleans → Yes/No, everything else → raw value (truncated local name for URIs). */
export function formatPanelValue(prop: PanelProperty): string {
  if (prop.valueType === 'uri') {
    return extractLocalName(prop.value);
  }

  const dt = prop.datatype || '';

  // Dates
  if (dt.includes('dateTime') || dt.includes('date')) {
    return formatDateValue(prop.value);
  }

  // Booleans
  if (dt.includes('boolean')) {
    return prop.value === 'true' || prop.value === '1' ? 'Yes' : 'No';
  }

  return prop.value;
}
