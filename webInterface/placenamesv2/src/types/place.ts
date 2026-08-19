/** Types describing a place's data shape. */

/** A place's full detail as returned from a SPARQL query. */
export interface PlaceDetail {
  /** Unique URI of the place in the knowledge graph */
  placeUri: string;

  /** The official place name (e.g. "Cave Creek") */
  name: string;

  /** What type of place it is (e.g. "Watercourse", "Suburb", "Mountain") */
  classification: string;

  /** Registration status (e.g. "gazetted", "proposed") */
  status: string;

  /** When the name was officially registered */
  dateGazetted: string | null;

  /** Which state/territory (e.g. "Victoria", "New South Wales") */
  location: string;

  /** Which government department registered the name */
  publisher: string;

  /** Whether this is an Indigenous place name */
  isIndigenous: boolean;

  /** Geometry as WKT string (e.g. "POINT(146.6 -37.3)" or "MULTIPOLYGON((...))") */
  geometry: string;

  /** URI of the PlaceName node (for knowledge graph display) */
  placeNameUri: string;

  /** If this place exists in another state, the URI of the linked place */
  crossBorderPlace: string | null;

  /** Web page link for more information (from the naming authority) */
  webPage: string | null;

  /** The geometry URI used to query this place (from PMTiles) */
  geometryUri: string;
}

/** A nearby place result — lighter than full PlaceDetail. */
export interface NearbyPlace {
  placeUri: string;
  name: string;
  classification: string;
  geometryUri: string;
  geometry: string;
}

/** What we get from PMTiles on a map click — just enough to query SPARQL for full details. */
export interface MapFeatureProperties {
  /** The geometry URI — used to look up the place in SPARQL */
  id: string;
}

/* Multi-valued place model — supports the full PNKG ontology's many-to-many
   relationships across PlaceNames, Geometries, and cross-border equivalences. */

/** A single PlaceName instance with its own metadata */
export interface PlaceNameRecord {
  uri: string;
  name: string;
  /** dcterms:identifier — shown eagerly on the green PlaceName canvas node (graphBuilder.ts). */
  identifier: string | null;
  status: string;
  dateGazetted: string | null;
  isIndigenous: boolean;
  publisher: string | null;
  location: string | null;
  /** Real URI of the Publisher resource — lets the graph reuse the same node if reached again via generic expansion, instead of a visual duplicate. */
  publisherUri: string | null;
  /** Real URI of the Location resource (dcterms:spatial target) — same reasoning as publisherUri. */
  locationUri: string | null;
  metaDataUri: string | null;
  wasNamedBy: string | null;
}

/** A single Geometry instance */
export interface GeometryRecord {
  uri: string;
  wkt: string;
  type: string; // "Point", "MultiPolygon", "MultiLineString", etc.
}

/** A cross-border equivalent place */
export interface CrossBorderRecord {
  placeUri: string;
  name: string;
  state: string; // "NSW", "VIC", etc.
}

/** Full multi-valued place data from SPARQL */
export interface MultiValuedPlace {
  /** Place URI */
  placeUri: string;
  /** dcterms:identifier on the Place resource itself — distinct from its PlaceNames' own
   *  identifiers. Shown on the blue Place canvas node (graphBuilder.ts). */
  identifier: string | null;
  /** Classification label (decoded) */
  classification: string;
  /** Full classification URI from the ontology */
  classificationUri: string | null;
  /** All PlaceName instances for this place */
  names: PlaceNameRecord[];
  /** All Geometry instances for this place */
  geometries: GeometryRecord[];
  /** Cross-border equivalent places (skos:exactMatch) */
  crossBorderPlaces: CrossBorderRecord[];
  /** Other places sharing the same geometry */
  sharedGeometryPlaces: Array<{ placeUri: string; name: string; classification: string }>;
}

/** Result of querying a geometry — may return multiple Place instances */
export interface GeometryQueryResult {
  /** All Place instances linked to this geometry */
  places: MultiValuedPlace[];
  /** The geometry URI that was queried */
  geometryUri: string;
}
