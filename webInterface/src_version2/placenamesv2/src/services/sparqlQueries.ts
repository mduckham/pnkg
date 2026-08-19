/** SPARQL query builders for places, geometries, and related data. */

/** Common prefixes used in all queries. */
const PREFIXES = `
PREFIX pn:      <http://linked.data.gov.au/def/placenames/>
PREFIX geo:     <http://www.opengis.net/ont/geosparql#>
PREFIX spatialF: <http://jena.apache.org/function/spatial#>
PREFIX dcterms: <http://purl.org/dc/terms/>
PREFIX loci:    <http://linked.data.gov.au/def/loci#>
PREFIX owl:     <http://www.w3.org/2002/07/owl#>
PREFIX foaf:    <http://xmlns.com/foaf/0.1/>
PREFIX skos:    <http://www.w3.org/2004/02/skos/core#>
PREFIX dcat:    <http://www.w3.org/ns/dcat#>
PREFIX uom:     <http://www.opengis.net/def/uom/OGC/1.0/>
`;

/** Full place details by geometry URI — direct graph lookup (?place geo:hasGeometry <URI>, <200ms) instead of the old spatialF:equals() spatial comparison (4-5s). */
export function buildPlaceDetailByGeometryQuery(geometryUri: string): string {
  return `${PREFIXES}
PREFIX dcat: <http://www.w3.org/ns/dcat#>

SELECT ?name ?category ?place ?plnm ?dateGazetted ?status ?location ?publisher
       ?isIndigenousPN ?geom ?place2 ?webPage
  (REPLACE(STRAFTER(STR(?status),
   "http://linked.data.gov.au/def/placenames/"), "%20", " ") AS ?statusLabel)
  (REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
    STRAFTER(STR(?category), "http://pid.geoscience.gov.au/def/voc/ga/PlaceType/"),
    "%20", " "), "%28", "("), "%29", ")"), "%2C", ","), "%2F", "/"), "_", " ") AS ?categoryLabel)
WHERE {
  ?place geo:hasGeometry <${geometryUri}> .
  <${geometryUri}> geo:asWKT ?geom .
  ?place pn:hasPlaceClassification ?category .
  ?place pn:hasPlaceName ?plnm .
  ?plnm pn:name ?name .

  OPTIONAL { ?plnm pn:status ?status . }
  OPTIONAL { ?plnm pn:dateGazetted ?dateGazetted . }
  OPTIONAL { ?plnm pn:isIndigenous ?isIndigenousPN . }
  OPTIONAL {
    ?plnm loci:isMemberOf ?metaData .
    OPTIONAL { ?metaData dcterms:spatial ?locationInstance . }
    OPTIONAL { ?locationInstance skos:prefLabel ?location . }
    OPTIONAL { ?metaData dcterms:publisher ?publisherInstance . }
    OPTIONAL { ?publisherInstance foaf:name ?publisher . }
    OPTIONAL { ?metaData dcat:landingPage ?webPage . }
  }
  OPTIONAL { ?place skos:exactMatch ?place2 . }
}`;
}

function escapeSparqlRegex(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/"/g, "\\\"")
    .replace(/\//g, "\\/")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\*/g, "\\*")
    .replace(/\+/g, "\\+")
    .replace(/\?/g, "\\?")
    .replace(/\^/g, "\\^")
    .replace(/\$/g, "\\$")
    .replace(/\|/g, "\\|")
    .replace(/\./g, "\\.")
    .replace(/-/g, "\\-");
}

/** "As you type" name suggestions — a bare DISTINCT-name PREFIX match, deliberately lighter than buildSearchQuery (skips the geo:hasGeometry/asWKT check, ~3-4x cheaper) since it fires on every keystroke with no debounce; the real search re-validates on submit. */
export function buildNameSuggestionsQuery(term: string): string {
  const escaped = escapeSparqlRegex(term.trim());
  return `${PREFIXES}
SELECT DISTINCT ?name WHERE {
  ?plnm pn:name ?name ;
        loci:isMemberOf ?metaData .
  FILTER(REGEX(STR(?name), "^${escaped}", "i"))
}
LIMIT 15`;
}

/** Real search — CONTAINS/anywhere match, checks geo:hasGeometry/asWKT existence. */
export function buildSearchQuery(
  searchText: string,
  states: string[] = [],
  exactMatch: boolean = false,
  indigenousOnly: boolean = false,
  crossBorder: boolean = false
): string {
  // Build the FILTER clause based on options
  const nameFilter = searchText.trim()
    ? (exactMatch
      ? `FILTER(LCASE(?name) = LCASE("${searchText}"))`
      : (() => {
          const escaped = escapeSparqlRegex(searchText.trim());
          return `FILTER(REGEX(?name, "${escaped}", "i"))`;
        })())
    : ""; // Empty search text = no name filter (show all matching other filters)

  // stateFilter removed — now using stateUriFilter (faster URI-based filtering)

  // Fast state filter using URI pattern (much faster than joining through metadata)
  const stateUriFilter = states.length > 0 && states.length < 8
    ? (() => {
        const stateAbbrevs: Record<string, string> = {
          "Australian Capital Territory": "ACT",
          "New South Wales": "NSW",
          "Northern Territory": "NT",
          "Queensland": "QLD",
          "South Australia": "SA",
          "Tasmania": "TAS",
          "Victoria": "VIC",
          "Western Australia": "WA",
        };
        const abbrevs = states.map(s => stateAbbrevs[s]).filter(Boolean);
        if (abbrevs.length === 1) {
          return `FILTER(CONTAINS(STR(?place), "/${abbrevs[0]}/"))`;
        }
        return `FILTER(${abbrevs.map(a => `CONTAINS(STR(?place), "/${a}/")`).join(" || ")})`;
      })()
    : "";

  const indigenousFilter = indigenousOnly
    ? `FILTER(?isIndigenousPN = "true"^^<http://www.w3.org/2001/XMLSchema#boolean>)`
    : "";

  const crossBorderFilter = crossBorder
    ? `?place skos:exactMatch ?place2 .`
    : "";

  return `${PREFIXES}
SELECT DISTINCT ?place ?name ?plnm ?category ?geomUri ?geom ?location ?isIndigenousPN
WHERE {
  ?place pn:hasPlaceName ?plnm .
  ?plnm pn:name ?name .
  ${nameFilter}
  ${crossBorderFilter}

  OPTIONAL { ?place pn:hasPlaceClassification ?category . }
  OPTIONAL {
    ?place geo:hasGeometry ?geomUri .
    ?geomUri geo:asWKT ?geom .
  }
  ${indigenousOnly ? `?plnm pn:isIndigenous ?isIndigenousPN .
  ${indigenousFilter}` : `OPTIONAL { ?plnm pn:isIndigenous ?isIndigenousPN . }`}
  ${states.length > 0 && states.length < 8 ? `
  ${stateUriFilter}
  OPTIONAL {
    ?plnm loci:isMemberOf ?metaData .
    ?metaData dcterms:spatial ?locationInstance .
    ?locationInstance skos:prefLabel ?location .
  }` : `
  OPTIONAL {
    ?plnm loci:isMemberOf ?metaData .
    ?metaData dcterms:spatial ?locationInstance .
    ?locationInstance skos:prefLabel ?location .
  }`}
}
ORDER BY LCASE(STR(?name))
LIMIT 2000`;
}

/** Nearby places within a distance from a point, with names, categories, and geometry. */
export function buildNearbyPlacesAllQuery(wktPoint: string, distanceKm: number): string {
  return `${PREFIXES}
SELECT DISTINCT ?place ?name ?category ?geomUri ?wkt
WHERE {
  ?geomUri geo:asWKT ?wkt .
  ?place geo:hasGeometry ?geomUri .
  ?place pn:hasPlaceClassification ?category .
  ?place pn:hasPlaceName ?plnm .
  ?plnm pn:name ?name .
  FILTER(spatialF:nearby(?wkt, "${wktPoint}"^^geo:wktLiteral, ${distanceKm}, uom:kilometre))
}
LIMIT 100`;
}

/** Fetches all multi-valued data for a geometry in one query — finds every place with the same WKT coordinates even under a different geometry URI (shared-geometry scenarios). */
export function buildMultiValuedPlaceQuery(geometryUri: string): string {
  return `${PREFIXES}

SELECT ?place ?name ?plnm ?plnmIdentifier ?placeIdentifier ?category ?categoryLabel ?status ?statusLabel
       ?dateGazetted ?isIndigenous ?geomUri ?geom ?publisher ?location
       ?publisherInst ?locationInst
       ?crossBorderPlace ?crossBorderName ?metaData ?wasNamedBy
WHERE {
  {
    # Find all places at the same location using WKT string equality
    # (indexed literal comparison — much faster than spatialF:equals)
    SELECT DISTINCT ?place
    WHERE {
      <${geometryUri}> geo:asWKT ?targetWkt .
      ?locMatch geo:asWKT ?targetWkt .
      ?place geo:hasGeometry ?locMatch .
    }
  }

  ?place pn:hasPlaceClassification ?category .
  ?place pn:hasPlaceName ?plnm .
  ?plnm pn:name ?name .

  OPTIONAL { ?place dcterms:identifier ?placeIdentifier . }
  OPTIONAL { ?plnm dcterms:identifier ?plnmIdentifier . }
  OPTIONAL { ?plnm pn:status ?status . }
  OPTIONAL { ?plnm pn:dateGazetted ?dateGazetted . }
  OPTIONAL { ?plnm pn:isIndigenous ?isIndigenous . }
  OPTIONAL { ?plnm pn:wasNamedBy ?wasNamedBy . }
  
  OPTIONAL {
    ?plnm loci:isMemberOf ?metaData .
    OPTIONAL { ?metaData dcterms:spatial ?locationInst . ?locationInst skos:prefLabel ?location . }
    OPTIONAL { ?metaData dcterms:publisher ?publisherInst . ?publisherInst foaf:name ?publisher . }
  }
  
  OPTIONAL {
    ?place geo:hasGeometry ?geomUri .
    ?geomUri geo:asWKT ?geom .
  }
  
  OPTIONAL {
    { ?place skos:exactMatch ?crossBorderPlace . }
    UNION
    { ?crossBorderPlace skos:exactMatch ?place . }
    ?crossBorderPlace pn:hasPlaceName ?cbPlnm .
    ?cbPlnm pn:name ?crossBorderName .
  }
  
  BIND(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
    STRAFTER(STR(?category), "http://pid.geoscience.gov.au/def/voc/ga/PlaceType/"),
    "%20", " "), "%28", "("), "%29", ")"), "%2C", ","), "%2F", "/"), "_", " ") AS ?categoryLabel)
  BIND(REPLACE(STRAFTER(STR(?status), "http://linked.data.gov.au/def/placenames/"), "%20", " ") AS ?statusLabel)
}`;
}

/** Same shape as buildMultiValuedPlaceQuery, anchored on a Place URI directly — for Cross-border entries, whose own record isn't part of the geometry-anchored results. */
export function buildPlaceDetailByPlaceUriQuery(placeUri: string): string {
  return `${PREFIXES}

SELECT ?place ?name ?plnm ?plnmIdentifier ?placeIdentifier ?category ?categoryLabel ?status ?statusLabel
       ?dateGazetted ?isIndigenous ?geomUri ?geom ?publisher ?location
       ?publisherInst ?locationInst
       ?crossBorderPlace ?crossBorderName ?metaData ?wasNamedBy
WHERE {
  BIND(<${placeUri}> AS ?place)

  ?place pn:hasPlaceClassification ?category .
  ?place pn:hasPlaceName ?plnm .
  ?plnm pn:name ?name .

  OPTIONAL { ?place dcterms:identifier ?placeIdentifier . }
  OPTIONAL { ?plnm dcterms:identifier ?plnmIdentifier . }
  OPTIONAL { ?plnm pn:status ?status . }
  OPTIONAL { ?plnm pn:dateGazetted ?dateGazetted . }
  OPTIONAL { ?plnm pn:isIndigenous ?isIndigenous . }
  OPTIONAL { ?plnm pn:wasNamedBy ?wasNamedBy . }

  OPTIONAL {
    ?plnm loci:isMemberOf ?metaData .
    OPTIONAL { ?metaData dcterms:spatial ?locationInst . ?locationInst skos:prefLabel ?location . }
    OPTIONAL { ?metaData dcterms:publisher ?publisherInst . ?publisherInst foaf:name ?publisher . }
  }

  OPTIONAL {
    ?place geo:hasGeometry ?geomUri .
    ?geomUri geo:asWKT ?geom .
  }

  OPTIONAL {
    { ?place skos:exactMatch ?crossBorderPlace . }
    UNION
    { ?crossBorderPlace skos:exactMatch ?place . }
    ?crossBorderPlace pn:hasPlaceName ?cbPlnm .
    ?cbPlnm pn:name ?crossBorderName .
  }

  BIND(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
    STRAFTER(STR(?category), "http://pid.geoscience.gov.au/def/voc/ga/PlaceType/"),
    "%20", " "), "%28", "("), "%29", ")"), "%2C", ","), "%2F", "/"), "_", " ") AS ?categoryLabel)
  BIND(REPLACE(STRAFTER(STR(?status), "http://linked.data.gov.au/def/placenames/"), "%20", " ") AS ?statusLabel)
}`;
}

