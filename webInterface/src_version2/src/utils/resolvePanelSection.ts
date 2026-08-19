/** Fast path: maps a clicked KG node to its DataPanel accordion section using already-loaded MultiValuedPlace data (no fetch) — only resolves a place's own Names/Geometries/Cross-border; returns null (triggering findResourcePath.ts's async tree search) for anything nested deeper, e.g. Metadata/Publisher. */

import type { MultiValuedPlace } from "../types/place";
import type { SelectedGraphNode } from "../hooks/useSelectedGraphNode";

export type SectionCategory = "geometry" | "names" | "crossBorder" | "place";

/** Namespaces a category by its owning place's URI so a shared-geometry click across stacked MultiValuedPlace panels can't cross-wire the wrong place's section. */
export function sectionKey(placeUri: string, category: SectionCategory): string {
  return `${placeUri}::${category}`;
}

export function resolvePanelSection(
  node: SelectedGraphNode | null,
  places: MultiValuedPlace[]
): string | null {
  if (!node) return null;

  for (const place of places) {
    if (node.uri && place.geometries.some((g) => g.uri === node.uri)) {
      return sectionKey(place.placeUri, "geometry");
    }
    if (node.uri && place.names.some((n) => n.uri === node.uri)) {
      return sectionKey(place.placeUri, "names");
    }
    // Metadata/Publisher/Location/etc. deliberately not handled here (see module doc) — falls through to null so DataPanel's async findResourcePath search finds the right nested section.
    if (node.uri && place.crossBorderPlaces.some((cb) => cb.placeUri === node.uri)) {
      return sectionKey(place.placeUri, "crossBorder");
    }
    // The Place node itself, or its classification badge. Classification's canvas node is keyed
    // by a synthetic id (class:<value>), not a real URI, whenever the backend has no
    // classificationUri for it — so match on id too, not just uri (graphBuilder.ts's own
    // convention for this node, unchanged here).
    if (node.uri === place.placeUri || node.id === `class:${place.classification}`) {
      return sectionKey(place.placeUri, "place");
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

/** Literal-value counterpart to resolvePanelSection: a literal node has only a synthetic id, so this maps it to its real owning resource's URI plus which property row to highlight — covers only graphBuilder.ts's eager-render id patterns, not generic-expansion literals.
 *  Every id below is now keyed by its owning resource's own uri (per-owner grey nodes, not
 *  shared by value — see graphBuilder.ts/useGraphExpansion.ts), so the owner uri is just the
 *  id's suffix; no `places` search needed any more. */
export function resolveLiteralOwnerUri(id: string): ResolvedLiteralOwner | null {
  // Name literal — "<nameUri>::name"
  if (id.endsWith("::name")) {
    return { ownerUri: id.slice(0, -"::name".length), predicate: PN_NAME_PREDICATE };
  }
  // WKT literal — "literal:wkt:<geometryUri>"
  if (id.startsWith("literal:wkt:")) {
    return { ownerUri: id.slice("literal:wkt:".length), predicate: GEO_AS_WKT_PREDICATE };
  }
  // Status literal — "literal:status:<placeNameUri>"
  if (id.startsWith("literal:status:")) {
    return { ownerUri: id.slice("literal:status:".length), predicate: PN_STATUS_PREDICATE };
  }
  // Publisher name literal — "literal:pub:<publisherUri>", resolves to the PUBLISHER RESOURCE's
  // own uri (one hop further), landing where clicking the Publisher node itself would, highlighting its own foaf:name row.
  if (id.startsWith("literal:pub:")) {
    return { ownerUri: id.slice("literal:pub:".length), predicate: FOAF_NAME_PREDICATE };
  }
  // Location label literal — "literal:loc:<locationUri>", same reasoning.
  if (id.startsWith("literal:loc:")) {
    return { ownerUri: id.slice("literal:loc:".length), predicate: SKOS_PREF_LABEL_PREDICATE };
  }
  return null;
}
