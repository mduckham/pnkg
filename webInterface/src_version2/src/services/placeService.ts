/** Bridges raw SPARQL results and UI components: builds queries, sends them to Fuseki, parses responses into PlaceDetail objects. */

import { querySparql, getValue, getLocalName, type SparqlBinding } from "./sparqlService";
import { buildSearchQuery, buildPlaceDetailByGeometryQuery, buildNearbyPlacesAllQuery, buildNameSuggestionsQuery, buildPlaceDetailByPlaceUriQuery } from "./sparqlQueries";
import { parseMultiValuedBindings } from "../hooks/useMultiValuedPlace";
import type { PlaceDetail, NearbyPlace, MultiValuedPlace } from "../types/place";

/** Full multi-valued detail for a Cross-border place given its own Place URI — reuses parseMultiValuedBindings so it behaves identically to any other PlaceView, no special-casing elsewhere. */
export async function fetchMultiValuedPlaceByPlaceUri(placeUri: string): Promise<MultiValuedPlace | null> {
  const query = buildPlaceDetailByPlaceUriQuery(placeUri);
  const response = await querySparql(query);
  const bindings = (response.results?.bindings || []) as SparqlBinding[];
  if (bindings.length === 0) return null;
  const { places } = parseMultiValuedBindings(bindings, placeUri);
  return places.find((p) => p.placeUri === placeUri) ?? places[0] ?? null;
}

/** "As you type" name suggestions — bare distinct name strings; the caller (SearchBar.tsx)
 *  is responsible for calling this on every keystroke, this doesn't debounce on its own. */
export async function fetchNameSuggestions(term: string, signal?: AbortSignal): Promise<string[]> {
  if (!term.trim()) return [];
  const query = buildNameSuggestionsQuery(term);
  const results = await querySparql(query, signal);
  return results.results.bindings
    .map((b) => getValue(b, "name"))
    .filter((name): name is string => !!name);
}

/** Searches places by name with optional filters, on explicit Search submit. */
export async function searchPlaces(
  searchText: string,
  states: string[] = [],
  exactMatch: boolean = false,
  indigenousOnly: boolean = false,
  crossBorder: boolean = false
): Promise<PlaceDetail[]> {
  const query = buildSearchQuery(searchText, states, exactMatch, indigenousOnly, crossBorder);
  const results = await querySparql(query);

  const parsed = results.results.bindings.map((binding) => {
    const categoryUri = getValue(binding, "category") || "";
    const geometry = getValue(binding, "geom") || "";
    const geometryUri = getValue(binding, "geomUri") || "";

    return {
      placeUri: getValue(binding, "place") || "",
      name: getValue(binding, "name") || "Unknown",
      classification: categoryUri ? decodeClassification(categoryUri) : "Unclassified",
      status: "",
      dateGazetted: null,
      location: getValue(binding, "location") || "",
      publisher: "",
      isIndigenous: getValue(binding, "isIndigenousPN") === "true",
      geometry,
      // The specific PlaceName record this search result matched, so the panel can show
      // it as primary instead of an arbitrary one re-picked by a later geometry-only refetch.
      placeNameUri: getValue(binding, "plnm") || "",
      crossBorderPlace: null,
      webPage: null,
      geometryUri,
    };
  });

  // Places without a geometry URI can't be navigated to on the map.
  const filtered = parsed.filter((place) => place.geometryUri);

  // Dedupe by place URI so a place with multiple geometries appears only once.
  const uniqueByPlace = new Map<string, PlaceDetail>();
  const isPoint = (wkt: string) => /^\s*POINT\(/i.test(wkt);

  for (const place of filtered) {
    const existing = uniqueByPlace.get(place.placeUri);
    if (!existing) {
      uniqueByPlace.set(place.placeUri, place);
      continue;
    }

    // Prefer a POINT geometry if one of the rows provides it.
    if (!isPoint(existing.geometry) && isPoint(place.geometry)) {
      uniqueByPlace.set(place.placeUri, place);
    }
  }

  return Array.from(uniqueByPlace.values());
}

/** Full details for a single place, by geometry URI (map clicks) or place URI (search results). */
export async function getPlaceDetails(uri: string): Promise<PlaceDetail | null> {
  const query = buildPlaceDetailByGeometryQuery(uri);
  const results = await querySparql(query);

  if (results.results.bindings.length === 0) return null;

  const first = results.results.bindings[0];
  const categoryLabel = getValue(first, "categoryLabel") || "";
  const categoryUri = getValue(first, "category") || "";

  return {
    placeUri: getValue(first, "place") || uri,
    name: getValue(first, "name") || "Unknown",
    classification: categoryLabel || (categoryUri ? decodeClassification(categoryUri) : "Unclassified"),
    status: getValue(first, "statusLabel") || "",
    dateGazetted: getValue(first, "dateGazetted") || null,
    location: getValue(first, "location") || "",
    publisher: getValue(first, "publisher") || "",
    isIndigenous: getValue(first, "isIndigenousPN") === "true",
    geometry: getValue(first, "geom") || "",
    placeNameUri: getValue(first, "plnm") || "",
    crossBorderPlace: getValue(first, "place2") || null,
    webPage: getValue(first, "webPage") || null,
    geometryUri: uri,
  };
}

/** Nearby places within a distance from a WKT point. */
export async function getNearbyPlaces(
  wktPoint: string,
  distanceKm: number
): Promise<NearbyPlace[]> {
  const query = buildNearbyPlacesAllQuery(wktPoint, distanceKm);
  const results = await querySparql(query);

  return results.results.bindings.map((binding) => {
    const categoryUri = getValue(binding, "category") || "";
    return {
      placeUri: getValue(binding, "place") || "",
      name: getValue(binding, "name") || "Unknown",
      classification: categoryUri ? decodeClassification(categoryUri) : "Unclassified",
      geometryUri: getValue(binding, "geomUri") || "",
      geometry: getValue(binding, "wkt") || "",
    };
  });
}

/** Decodes a classification URI into a readable label, e.g. ".../PlaceType/WATERCOURSE" -> "Watercourse". */
function decodeClassification(uri: string): string {
  const raw = getLocalName(uri);
  const decoded = decodeURIComponent(raw).replace(/_/g, " ");
  return decoded.charAt(0).toUpperCase() + decoded.slice(1).toLowerCase();
}
