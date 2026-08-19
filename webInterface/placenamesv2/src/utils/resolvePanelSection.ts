/** Fast path: maps a clicked KG node to its DataPanel accordion section using already-loaded MultiValuedPlace data (no fetch) — only resolves a place's own Names/Geometries/Cross-border; returns null (triggering findResourcePath.ts's async tree search) for anything nested deeper, e.g. Metadata/Publisher. */

import type { MultiValuedPlace } from "../types/place";
import type { SelectedGraphNode } from "../hooks/useSelectedGraphNode";

export type SectionCategory = "geometry" | "names" | "crossBorder";

/** Namespaces a category by its owning place's URI so a shared-geometry click across stacked MultiValuedPlace panels can't cross-wire the wrong place's section. */
export function sectionKey(placeUri: string, category: SectionCategory): string {
  return `${placeUri}::${category}`;
}

export function resolvePanelSection(
  node: SelectedGraphNode | null,
  places: MultiValuedPlace[]
): string | null {
  if (!node?.uri) return null;

  for (const place of places) {
    if (place.geometries.some((g) => g.uri === node.uri)) {
      return sectionKey(place.placeUri, "geometry");
    }
    if (place.names.some((n) => n.uri === node.uri)) {
      return sectionKey(place.placeUri, "names");
    }
    // Metadata/Publisher/Location/etc. deliberately not handled here (see module doc) — falls through to null so DataPanel's async findResourcePath search finds the right nested section.
    if (place.crossBorderPlaces.some((cb) => cb.placeUri === node.uri)) {
      return sectionKey(place.placeUri, "crossBorder");
    }
  }

  return null;
}

/** Predicate URIs for the eager literal nodes graphBuilder.ts renders — used only to tell resolveLiteralOwnerUri's caller which property row to highlight. */
const PN_NAME_PREDICATE = "http://linked.data.gov.au/def/placenames/name";
const PN_STATUS_PREDICATE = "http://linked.data.gov.au/def/placenames/status";
const GEO_AS_WKT_PREDICATE = "http://www.opengis.net/ont/geosparql#asWKT";
const FOAF_NAME_PREDICATE = "http://xmlns.com/foaf/0.1/name";
const SKOS_PREF_LABEL_PREDICATE = "http://www.w3.org/2004/02/skos/core#prefLabel";

export interface ResolvedLiteralOwner {
  ownerUri: string;
  /** Which of the owner's own property rows this literal corresponds to, so the panel can highlight that specific row once the section is open. */
  predicate: string;
}

/** Literal-value counterpart to resolvePanelSection: a literal node has only a synthetic id, so this maps it to its real owning resource's URI plus which property row to highlight — covers only graphBuilder.ts's eager-render id patterns, not generic-expansion literals. */
export function resolveLiteralOwnerUri(id: string, places: MultiValuedPlace[]): ResolvedLiteralOwner | null {
  // Name literal — "<nameUri>::name"
  if (id.endsWith("::name")) {
    return { ownerUri: id.slice(0, -"::name".length), predicate: PN_NAME_PREDICATE };
  }
  // WKT literal — "literal:wkt:<geometryUri>"
  if (id.startsWith("literal:wkt:")) {
    return { ownerUri: id.slice("literal:wkt:".length), predicate: GEO_AS_WKT_PREDICATE };
  }
  // Status literal — value-keyed (graphBuilder.ts dedupes identical status text onto one shared node), so match against whichever of this place's names actually has that status.
  if (id.startsWith("literal:status:")) {
    const value = id.slice("literal:status:".length);
    for (const place of places) {
      const match = place.names.find((n) => n.status === value);
      if (match) return { ownerUri: match.uri, predicate: PN_STATUS_PREDICATE };
    }
    return null;
  }
  // Publisher name literal — resolves to the PUBLISHER RESOURCE's own uri (one hop further), landing where clicking the Publisher node itself would, highlighting its own foaf:name row.
  if (id.startsWith("literal:pub:")) {
    const value = id.slice("literal:pub:".length);
    for (const place of places) {
      const match = place.names.find((n) => n.publisher === value && n.publisherUri);
      if (match?.publisherUri) return { ownerUri: match.publisherUri, predicate: FOAF_NAME_PREDICATE };
    }
    return null;
  }
  // Location label literal — "literal:loc:<value>", same reasoning.
  if (id.startsWith("literal:loc:")) {
    const value = id.slice("literal:loc:".length);
    for (const place of places) {
      const match = place.names.find((n) => n.location === value && n.locationUri);
      if (match?.locationUri) return { ownerUri: match.locationUri, predicate: SKOS_PREF_LABEL_PREDICATE };
    }
    return null;
  }
  return null;
}
