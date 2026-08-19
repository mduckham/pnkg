/** Central config so the app can be retargeted to a different knowledge graph dataset. */

export const appConfig = {
  // App identity
  title: "Australian Place Name Knowledge Graph",
  subtitle: "@RMIT",
  logoUrl: "https://gkl.rmit.melbourne/",
  aboutUrl: "https://gkl.rmit.melbourne/australian-place-name-knowledge-graph/",

  // SPARQL endpoint (POST). Dev: Vite proxies /sparql → Fuseki (avoids CORS).
  sparqlEndpoint: (import.meta.env as any).VITE_SPARQL_ENDPOINT || "/sparql",

  // Pre-built map tile file — every Point carries a precomputed recommendedZoom (see scripts/densityZoomConfig.mjs), replacing a slower, non-deterministic live SPARQL density query.
  pmtilesUrl: "/placenames-recommendedzoom.pmtiles",

  // Map settings — start focused on Victoria (RMIT is in Melbourne)
  map: {
    center: [145.0, -37.8] as [number, number], // Melbourne, Victoria
    zoom: 7,
    minZoom: 3,
    maxZoom: 18,

    /** Used whenever a recommendedZoom lookup fails or doesn't apply. */
    fallbackZoom: 12,

    /** Floor for "fit to this geometry's bbox" — without it, a far-flung MultiPolygon zooms out disorientingly far for what's still "one place." */
    geometryFitMinZoom: 9,
  },

  // MapTiler Outdoor basemap. Key comes from an env var (.env.local), never a literal here,
  // so it can't land in git history. Falls back to OpenFreeMap Liberty if unset.
  basemap: {
    default: (import.meta.env as any).VITE_MAPTILER_KEY
      ? `https://api.maptiler.com/maps/outdoor-v2/style.json?key=${(import.meta.env as any).VITE_MAPTILER_KEY}`
      : "https://tiles.openfreemap.org/styles/liberty",
  },

  // Single source of truth for node colour everywhere: the KG canvas/legend and the
  // unified data panel's identity dots.
  nodeTypes: {
    place: { label: "Place", color: "#add8e6", borderColor: "#6baed6" },
    placeName: { label: "PlaceName", color: "#90ee90", borderColor: "#5cb85c" },
    classification: { label: "Classification", color: "#e1bee7", borderColor: "#9c27b0" },
    geometry: { label: "Geometry", color: "#ffc896", borderColor: "#e67e22" },
    metaData: { label: "MetaData", color: "#ffff00", borderColor: "#c8c800" },
    literal: { label: "Value", color: "#f5f5f5", borderColor: "#bdbdbd" },
  },

  // Australian states for filter checkboxes
  states: [
    { value: "Australian Capital Territory", label: "ACT" },
    { value: "New South Wales", label: "NSW" },
    { value: "Northern Territory", label: "NT" },
    { value: "Queensland", label: "QLD" },
    { value: "South Australia", label: "SA" },
    { value: "Tasmania", label: "TAS" },
    { value: "Victoria", label: "VIC" },
    { value: "Western Australia", label: "WA" },
  ],

  // Edge line-style overrides only — colour is computed per-edge from whichever node it
  // points to (see nodeTypeEdgeColor below), not assigned per-predicate here.
  edgeStyles: {
    "skos:exactMatch": { lineStyle: "dashed" },
  } as Record<string, { lineStyle?: string }>,

  /** Fallback colour for edges pointing at an unrecognised node type. */
  defaultEdgeColor: "#9e9e9e",

  // Ontology metadata — maps node types to their RDF class, source ontology, and description.
  // When adapting for a new KG, update this mapping to reflect the new ontology.
  ontologyInfo: {
    place: { className: "Place", ontology: "Australian Placenames Ontology", namespace: "http://linked.data.gov.au/def/placenames/", description: "A geographic feature or location that has been named" },
    placeName: { className: "PlaceName", ontology: "Australian Placenames Ontology", namespace: "http://linked.data.gov.au/def/placenames/", description: "A specific name given to a geographic feature" },
    classification: { className: "PlaceClassification", ontology: "GA PlaceType Vocabulary", namespace: "http://pid.geoscience.gov.au/def/voc/ga/PlaceType/", description: "A category describing the type of geographic feature" },
    geometry: { className: "Geometry", ontology: "GeoSPARQL Ontology", namespace: "http://www.opengis.net/ont/geosparql#", description: "The spatial representation of a geographic feature" },
    metaData: { className: "PlaceNameMetaData", ontology: "Australian Placenames Ontology", namespace: "http://linked.data.gov.au/def/placenames/", description: "Administrative metadata about a place name record" },
    literal: { className: "Literal", ontology: "RDF/RDFS", namespace: "http://www.w3.org/2000/01/rdf-schema#", description: "A data value (text, date, or number)" },
  } as Record<string, { className: string; ontology: string; namespace: string; description: string }>,
};

/** Resolves an edge's colour from the type of node it points to, so every edge "arrives"
 *  in its destination's colour regardless of predicate. */
export function nodeTypeEdgeColor(nodeType: string | undefined): string {
  if (nodeType === 'resource') return appConfig.nodeTypes.literal.borderColor;
  const entry = appConfig.nodeTypes[nodeType as keyof typeof appConfig.nodeTypes];
  return entry?.borderColor ?? appConfig.defaultEdgeColor;
}
