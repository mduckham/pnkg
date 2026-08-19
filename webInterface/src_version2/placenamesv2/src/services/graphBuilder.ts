/** Builds the initial GraphData from a place's SPARQL result — real URIs as node ids,
 *  full ontology predicates as edge labels, deduplicated via a `seen` set. */

import type { PlaceDetail, GeometryQueryResult } from "../types/place";
import type { GraphData, GraphNode, GraphEdge } from "../types/graph";
import { formatWktLabel } from "./wktParser";
import { formatIdentifierLabel } from "./labelExtractor";

export function buildGraphFromMultiValuedData(data: GeometryQueryResult): GraphData {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();

  const primaryPlace = data.places[0];
  if (!primaryPlace) return { nodes, edges };

  // Helper: extract short ID from URI for display
  function shortId(uri: string): string {
    if (!uri) return "";
    const parts = uri.split("/");
    return decodeURIComponent(parts[parts.length - 1] || "");
  }

  // Helper: add node if not seen
  function addNode(id: string, label: string, type: string, uri?: string, fullLabel?: string) {
    if (seen.has(id)) return;
    seen.add(id);
    nodes.push({ id, label, fullLabel, type: type as GraphNode["type"], uri, x: 0, y: 0, radius: 30 });
  }

  // Helper: add edge with dedup. Tags a target's SECOND (or later) incoming edge as
  // sharedTarget — e.g. two PlaceNames of the same place sharing one MetaData node — so
  // graphNodeStyles.ts can bow it outward instead of cutting through whatever sits between
  // the two, since the target's position was only ever chosen relative to whichever edge
  // reached it first.
  const targetsWithIncoming = new Set<string>();
  function addEdge(source: string, target: string, label: string) {
    const edgeId = `${source}->${target}:${label}`;
    if (seen.has(edgeId)) return;
    seen.add(edgeId);
    const sharedTarget = targetsWithIncoming.has(target);
    targetsWithIncoming.add(target);
    edges.push({ source, target, label, sharedTarget });
  }

  // The shared geometry URI that was searched — key link between places at the same location.
  if (data.geometryUri) {
    addNode(data.geometryUri, `Geometry:\n${shortId(data.geometryUri)}`, "geometry", data.geometryUri);
    // WKT from the matching geometry, not just the first one.
    const sharedGeo = primaryPlace.geometries.find(g => g.uri === data.geometryUri) || primaryPlace.geometries[0];
    if (sharedGeo?.wkt) {
      const wktLabel = formatWktLabel(sharedGeo.wkt);
      const wktId = `literal:wkt:${data.geometryUri}`;
      addNode(wktId, wktLabel, "literal");
      addEdge(data.geometryUri, wktId, "geo:asWKT");
    }
  }

  for (const place of data.places) {
    // Matches v1's convention (formatIdentifierLabel, shared with presentationLayer.ts).
    const placeLabel = (place.identifier && formatIdentifierLabel('place', place.identifier))
      || "Place : " + shortId(place.placeUri);
    addNode(place.placeUri, placeLabel, "place", place.placeUri);

    if (data.geometryUri) {
      addEdge(place.placeUri, data.geometryUri, "geo:hasGeometry");
    }

    if (place.classification) {
      const classId = `class:${place.classification}`;
      const classUri = place.classificationUri || undefined;
      addNode(classId, place.classification, "classification", classUri);
      addEdge(place.placeUri, classId, "pn:hasPlaceClassification");
    }

    // Additional geometries beyond the shared one.
    for (const geo of place.geometries) {
      if (geo.uri !== data.geometryUri) {
        addNode(geo.uri, `Geometry:\n${shortId(geo.uri)}`, "geometry", geo.uri);
        addEdge(place.placeUri, geo.uri, "geo:hasGeometry");

        if (geo.wkt) {
          const wktLabel = formatWktLabel(geo.wkt);
          const wktId = `literal:wkt:${geo.uri}`;
          addNode(wktId, wktLabel, "literal");
          addEdge(geo.uri, wktId, "geo:asWKT");
        }
      }
    }

    for (const name of place.names) {
      const placeNameLabel = (name.identifier && formatIdentifierLabel('placeName', name.identifier))
        || name.name || "PlaceName : " + shortId(name.uri);
      addNode(name.uri, placeNameLabel, "placeName", name.uri);
      addEdge(place.placeUri, name.uri, "pn:hasPlaceName");

      const nameId = name.uri + "::name";
      addNode(nameId, name.name, "literal");
      addEdge(name.uri, nameId, "pn:name");

      // Per Nayomi/Prof's request: grey attribute/value nodes are duplicated per owning
      // resource (v1-style), not shared by value — only class/resource nodes (Place,
      // PlaceName, MetaData, Geometry, Publisher, Location) stay deduplicated. Old
      // shared-by-value version, kept in case that's preferred again later:
      // const statusId = `literal:status:${name.status}`;
      if (name.status) {
        const statusId = `literal:status:${name.uri}`;
        addNode(statusId, name.status, "literal");
        addEdge(name.uri, statusId, "pn:status");
      }

      // pn:dateGazetted intentionally not rendered as a node — shown only in the panel.

      // Per Nayomi/Prof's request: the naming Authority reads visually as a grey attribute
      // (styled the same as literal nodes), so — like status/publisher-name/location-name —
      // it's duplicated per owning PlaceName, not shared by URI like a real resource. `uri`
      // (5th addNode arg) still carries the real Authority URI, so click-through/expansion
      // still works normally. Old shared-by-URI version, kept in case that's preferred later:
      // addNode(name.wasNamedBy, authorityLabel, "resource", name.wasNamedBy, authorityLabel);
      // addEdge(name.uri, name.wasNamedBy, "pn:wasNamedBy");
      if (name.wasNamedBy) {
        const authorityLabel = decodeURIComponent(name.wasNamedBy.split('/').pop() || 'Authority');
        const authorityId = `${name.uri}::wasNamedBy`;
        addNode(authorityId, authorityLabel, "resource", name.wasNamedBy, authorityLabel);
        addEdge(name.uri, authorityId, "pn:wasNamedBy");
      }

      // One shared metadata node if publisher+location match. Node ids/labels match
      // useGraphExpansion.ts's VALUE_NODE_SPECS so a later expansion doesn't duplicate them.
      if (name.publisher || name.location) {
        const metaKey = `meta:${name.publisher || ''}:${name.location || ''}`;
        const metaUri = name.metaDataUri || undefined;
        addNode(metaKey, "Place Name\nMeta Data", "metaData", metaUri);
        addEdge(name.uri, metaKey, "loci:isMemberOf");

        if (name.publisherUri) {
          addNode(name.publisherUri, "Publisher", "metaData", name.publisherUri);
          addEdge(metaKey, name.publisherUri, "dcterms:publisher");
          if (name.publisher) {
            // Old shared-by-value version, kept in case that's preferred again later:
            // const pubLiteralId = `literal:pub:${name.publisher}`;
            const pubLiteralId = `literal:pub:${name.publisherUri}`;
            addNode(pubLiteralId, name.publisher, "literal");
            addEdge(name.publisherUri, pubLiteralId, "foaf:name");
          }
        }

        if (name.locationUri) {
          addNode(name.locationUri, "Location", "metaData", name.locationUri);
          addEdge(metaKey, name.locationUri, "dcterms:spatial");
          if (name.location) {
            // Old shared-by-value version, kept in case that's preferred again later:
            // const locLiteralId = `literal:loc:${name.location}`;
            const locLiteralId = `literal:loc:${name.locationUri}`;
            addNode(locLiteralId, name.location, "literal");
            addEdge(name.locationUri, locLiteralId, "skos:prefLabel");
          }
        }
      }
    }

    for (const cb of place.crossBorderPlaces) {
      addNode(cb.placeUri, "Place : " + shortId(cb.placeUri), "place", cb.placeUri);
      addEdge(place.placeUri, cb.placeUri, "skos:exactMatch");
    }
  }

  return { nodes, edges };
}

export function buildGraphFromPlace(place: PlaceDetail): GraphData {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();

  function shortId(uri: string): string {
    if (!uri) return "";
    const parts = uri.split("/");
    return decodeURIComponent(parts[parts.length - 1] || "");
  }

  function addNode(id: string, label: string, type: string, uri?: string, fullLabel?: string) {
    if (seen.has(id)) return;
    seen.add(id);
    nodes.push({ id, label, fullLabel, type: type as GraphNode["type"], uri, x: 0, y: 0, radius: 30 });
  }

  const targetsWithIncoming = new Set<string>();
  function addEdge(source: string, target: string, label: string) {
    const edgeId = `${source}->${target}:${label}`;
    if (seen.has(edgeId)) return;
    seen.add(edgeId);
    const sharedTarget = targetsWithIncoming.has(target);
    targetsWithIncoming.add(target);
    edges.push({ source, target, label, sharedTarget });
  }

  const placeId = place.placeUri || "place";
  addNode(placeId, "Place : " + shortId(place.placeUri), "place", place.placeUri);

  if (place.placeNameUri) {
    const placeNameLabel = place.name || "PlaceName : " + shortId(place.placeNameUri);
    addNode(place.placeNameUri, placeNameLabel, "placeName", place.placeNameUri);
    addEdge(placeId, place.placeNameUri, "pn:hasPlaceName");

    if (place.name) {
      const nameId = place.placeNameUri + "::name";
      addNode(nameId, place.name, "literal");
      addEdge(place.placeNameUri, nameId, "pn:name");
    }

    if (place.status) {
      // Old shared-by-value version, kept in case that's preferred again later:
      // const statusId = `literal:status:${place.status}`;
      const statusId = `literal:status:${place.placeNameUri}`;
      addNode(statusId, place.status, "literal");
      addEdge(place.placeNameUri, statusId, "pn:status");
    }

    // pn:dateGazetted intentionally not rendered as a node — shown only in the panel.

    // This builder is only the lock-snapshot fallback (buildGraphFromMultiValuedData
    // is the live render) — PlaceDetail has no metaDataUri, so this node renders without one.
    if (place.publisher || place.location) {
      const metaKey = `meta:${place.publisher || ''}:${place.location || ''}`;
      addNode(metaKey, "PlaceName MetaData", "metaData");
      addEdge(place.placeNameUri, metaKey, "loci:isMemberOf");
    }
  }

  if (place.geometryUri) {
    addNode(place.geometryUri, `Geometry:\n${shortId(place.geometryUri)}`, "geometry", place.geometryUri);
    addEdge(placeId, place.geometryUri, "geo:hasGeometry");
  }

  if (place.classification && place.classification !== "Unclassified") {
    const classId = `class:${place.classification}`;
    addNode(classId, place.classification, "classification");
    addEdge(placeId, classId, "pn:hasPlaceClassification");
  }

  if (place.crossBorderPlace) {
    addNode(place.crossBorderPlace, "Place : " + shortId(place.crossBorderPlace), "place", place.crossBorderPlace);
    addEdge(placeId, place.crossBorderPlace, "skos:exactMatch");
  }

  return { nodes, edges };
}
