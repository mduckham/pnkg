/** Resolves human-readable labels from URIs, ontology-agnostically, using URI structure and optional pre-resolved labels. */

/** Well-known prefix mappings, used to produce short "prefix:localName" labels for edges. */
const PREFIX_MAP: Record<string, string> = {
  'http://www.w3.org/1999/02/22-rdf-syntax-ns#': 'rdf',
  'http://www.w3.org/2000/01/rdf-schema#': 'rdfs',
  'http://www.w3.org/2002/07/owl#': 'owl',
  'http://www.w3.org/2004/02/skos/core#': 'skos',
  'http://xmlns.com/foaf/0.1/': 'foaf',
  'http://purl.org/dc/terms/': 'dcterms',
  'http://purl.org/dc/elements/1.1/': 'dc',
  'http://www.w3.org/ns/dcat#': 'dcat',
  'http://www.w3.org/ns/dqv#': 'dqv',
  'https://schema.org/': 'schema',
  'http://www.opengis.net/ont/geosparql#': 'geo',
  'http://www.opengis.net/ont/sf#': 'sf',
  'http://linked.data.gov.au/def/placenames/': 'pn',
  'http://linked.data.gov.au/def/loci#': 'loci',
  'http://linked.data.gov.au/def/fsdf/': 'fsdf',
  'http://www.w3.org/2006/vcard/ns#': 'vcard',
  'http://geosensor.net/ns/pnkg/': 'pnkg',
};

/** Extracts the local name from a URI (hash or slash separator), percent-decoded. */
export function extractLocalName(uri: string): string {
  if (!uri) return 'unknown';

  const hashIdx = uri.lastIndexOf('#');
  if (hashIdx >= 0 && hashIdx < uri.length - 1) {
    return decodeURIComponent(uri.slice(hashIdx + 1));
  }

  const slashIdx = uri.lastIndexOf('/');
  if (slashIdx >= 0 && slashIdx < uri.length - 1) {
    return decodeURIComponent(uri.slice(slashIdx + 1));
  }

  return decodeURIComponent(uri);
}

/** PNKG's namespace fragment, present in every internal resource URI — this one substring check is what "resource to follow" vs. "external link to just display" boils down to. */
const PNKG_NAMESPACE_FRAGMENT = 'geosensor.net/ns/pnkg';

/** True if `uri` is a resource inside this app's own knowledge graph. */
export function isInternalPnkgUri(uri: string): boolean {
  return uri.includes(PNKG_NAMESPACE_FRAGMENT);
}

/** This dataset's ontology namespace, distinct from PNKG_NAMESPACE_FRAGMENT (the data/instance namespace) — a property value living here is a controlled vocabulary term, not an external link. */
const OWN_ONTOLOGY_NAMESPACE_FRAGMENT = 'linked.data.gov.au/def/';

export function isOwnVocabularyTermUri(uri: string): boolean {
  return uri.includes(OWN_ONTOLOGY_NAMESPACE_FRAGMENT);
}

/** Formats a node's dcterms:identifier as "{TypeLabel}: {identifier}" — the single source of truth shared by graphBuilder.ts's initial render and presentationLayer.ts's expansion labelling; undefined for any nodeType this doesn't apply to. */
export function formatIdentifierLabel(nodeType: string, identifier: string): string | undefined {
  switch (nodeType) {
    case 'place': return `Place: ${identifier}`;
    case 'placeName': return `Placename: ${identifier}`;
    default: return undefined;
  }
}

/** "wasNamedBy" -> "Was Named By" — inserts spaces at camelCase/PascalCase boundaries and capitalises, so a bare local name reads as English instead of ontology/URI notation. */
export function humanizeLocalName(name: string): string {
  const spaced = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  if (!spaced) return '';
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Reads the resource-kind segment the URI scheme already encodes (e.g. ".../pnkg/Publisher/NSW" -> "Publisher") — a URI-structure signal that works for any kind without listing types here; skips a bare state code, which falls through to deriveResourceTitle instead. */
export function deriveResourceKindFromUri(uri: string): string | undefined {
  const idx = uri.indexOf(PNKG_NAMESPACE_FRAGMENT);
  if (idx === -1) return undefined;
  const afterNamespace = uri.slice(idx + PNKG_NAMESPACE_FRAGMENT.length);
  const first = afterNamespace.split('/').filter(Boolean)[0];
  if (!first) return undefined;
  const decoded = decodeURIComponent(first);
  if (STATE_CODES.has(decoded)) return undefined;
  if (!/^[A-Z][A-Za-z]*$/.test(decoded)) return undefined;
  return humanizeLocalName(decoded);
}

/** Australian state/territory abbreviations — resource URIs often end in one as a trailing scope qualifier, making extractLocalName alone a poor fit for those resources. */
const STATE_CODES = new Set(['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA']);

/** Like extractLocalName, but for "<meaningful-name>/<STATE>" URIs: when the last segment is a bare state code, returns the preceding segment instead (stripping a trailing "Metric") — otherwise several resource types per state return the same indistinguishable bare code. */
export function extractDistinguishingLocalName(uri: string): string {
  const bare = extractLocalName(uri);
  if (!STATE_CODES.has(bare)) return bare;

  const segments = uri.split('/').filter((s) => s.length > 0);
  if (segments.length < 2) return bare;
  const prevSegment = decodeURIComponent(segments[segments.length - 2]);
  if (!prevSegment || STATE_CODES.has(prevSegment)) return bare;

  return prevSegment.replace(/Metric$/, '');
}

/** Extracts a human-readable label: pre-resolved from knownLabels (SPARQL OPTIONAL), then falls back to the URI local name. */
export function extractLabel(uri: string, knownLabels?: Map<string, string>): string {
  if (!uri) return 'unknown';

  if (knownLabels) {
    const resolved = knownLabels.get(uri);
    if (resolved && resolved.trim().length > 0) {
      return resolved.trim();
    }
  }

  return extractLocalName(uri);
}

/** Extracts a display label for a predicate URI: configured override, then "prefix:localName", then bare local name. */
export function extractPredicateLabel(
  predicateUri: string,
  displayNameOverride?: string
): string {
  if (displayNameOverride && displayNameOverride.trim().length > 0) {
    return displayNameOverride.trim();
  }

  if (!predicateUri) return 'relates';

  for (const [namespace, prefix] of Object.entries(PREFIX_MAP)) {
    if (predicateUri.startsWith(namespace)) {
      const localName = predicateUri.slice(namespace.length);
      if (localName.length > 0) {
        return `${prefix}:${localName}`;
      }
    }
  }

  const localName = extractLocalName(predicateUri);
  return localName || 'relates';
}

/** True if `typeUri`'s final path segment is exactly `localName` — anchored so e.g. "PlaceNamingAuthority" doesn't match a plain-substring check for "Place". */
function typeUriEndsWithLocalName(typeUri: string, localName: string): boolean {
  return typeUri.endsWith(`/${localName}`) || typeUri.endsWith(`#${localName}`);
}

/** True specifically for the dcat:DataSet/MetaData hub type — not Publisher/Location, which share the same 'metaData' colour but are distinct resources with their own titles. */
export function isMetaDataHubType(typeUri: string | undefined): boolean {
  return !!typeUri && (typeUriEndsWithLocalName(typeUri, 'DataSet') || typeUriEndsWithLocalName(typeUri, 'MetaData'));
}

/** Infers a node type from an rdf:type URI or the node's own URI pattern, for visual styling. */
export function inferNodeType(uri: string, rdfType?: string): string {
  const typeUri = rdfType || uri;

  if (typeUri.includes('/Place/') || typeUriEndsWithLocalName(typeUri, 'Place')) return 'place';
  if (typeUri.includes('/PlaceName/') || typeUriEndsWithLocalName(typeUri, 'PlaceName')) return 'placeName';
  if (typeUri.includes('PlaceType/') || typeUri.includes('Classification')) return 'classification';
  if (typeUri.includes('/Geometry/') || typeUriEndsWithLocalName(typeUri, 'Geometry')) return 'geometry';
  if (isMetaDataHubType(typeUri)) return 'metaData';
  // Publisher/Location are part of the MetaData family (same yellow colour), matching graphBuilder.ts.
  if (typeUri.includes('/Publisher/') || typeUriEndsWithLocalName(typeUri, 'Agent')) return 'metaData';
  if (typeUri.includes('/Location/') || typeUriEndsWithLocalName(typeUri, 'Location')) return 'metaData';
  if (typeUri.includes('/Custodian/') || typeUriEndsWithLocalName(typeUri, 'Agency')) return 'resource';

  return 'resource';
}
