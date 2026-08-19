/** Fetches and caches multi-valued place data for a geometry URI — Place, PlaceName (with per-name metadata), Geometry, and cross-border records from the SPARQL endpoint. */

import { useState, useEffect, useRef } from 'react';
import { querySparql, getValue, type SparqlBinding } from '../services/sparqlService';
import { buildMultiValuedPlaceQuery } from '../services/sparqlQueries';
import type { GeometryQueryResult, MultiValuedPlace, PlaceNameRecord, GeometryRecord, CrossBorderRecord } from '../types/place';

interface UseMultiValuedPlaceResult {
  data: GeometryQueryResult | null;
  isLoading: boolean;
  error: string | null;
}

export function useMultiValuedPlace(geometryUri: string | undefined): UseMultiValuedPlaceResult {
  const [data, setData] = useState<GeometryQueryResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cacheRef = useRef<Map<string, GeometryQueryResult>>(new Map());

  useEffect(() => {
    if (!geometryUri) {
      setData(null);
      setIsLoading(false);
      return;
    }

    const cached = cacheRef.current.get(geometryUri);
    if (cached) {
      setData(cached);
      setIsLoading(false);
      return;
    }

    // Reset data and set loading for new URI
    setData(null);
    setIsLoading(true);
    setError(null);

    let cancelled = false;

    const fetchData = async () => {
      try {
        const query = buildMultiValuedPlaceQuery(geometryUri);
        const response = await querySparql(query);
        const bindings = (response.results?.bindings || []) as SparqlBinding[];

        if (cancelled) return;
        if (bindings.length === 0) {
          setData(null);
          setIsLoading(false);
          return;
        }

        // Parse bindings into MultiValuedPlace structures
        const result = parseMultiValuedBindings(bindings, geometryUri);
        cacheRef.current.set(geometryUri, result);
        setData(result);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to fetch place data');
          setData(null);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    fetchData();
    return () => { cancelled = true; };
  }, [geometryUri]);

  return { data, isLoading, error };
}

/** Exported so fetchPlaceDetailByPlaceUri (placeService.ts) can reuse this exact parsing rather than a drifting copy; `anchorUri` is just passed through as GeometryQueryResult.geometryUri, so a Place URI works as well as a real geometry URI. */
export function parseMultiValuedBindings(bindings: SparqlBinding[], anchorUri: string): GeometryQueryResult {
  // Group by place URI
  const placeMap = new Map<string, {
    identifier: string | null;
    classification: string;
    classificationUri: string | null;
    names: Map<string, PlaceNameRecord>;
    geometries: Map<string, GeometryRecord>;
    crossBorder: Map<string, CrossBorderRecord>;
  }>();

  for (const row of bindings) {
    const placeUri = getValue(row, 'place');
    if (!placeUri) continue;

    if (!placeMap.has(placeUri)) {
      const categoryLabel = getValue(row, 'categoryLabel') || getValue(row, 'category') || 'Unclassified';
      const categoryUri = getValue(row, 'category') || null;
      placeMap.set(placeUri, {
        identifier: getValue(row, 'placeIdentifier') || null,
        classification: categoryLabel,
        classificationUri: categoryUri,
        names: new Map(),
        geometries: new Map(),
        crossBorder: new Map(),
      });
    }

    const place = placeMap.get(placeUri)!;

    // Parse PlaceName
    const plnmUri = getValue(row, 'plnm');
    const name = getValue(row, 'name');
    if (plnmUri && name && !place.names.has(plnmUri)) {
      place.names.set(plnmUri, {
        uri: plnmUri,
        name,
        identifier: getValue(row, 'plnmIdentifier') || null,
        status: getValue(row, 'statusLabel') || getValue(row, 'status') || '',
        dateGazetted: getValue(row, 'dateGazetted') || null,
        isIndigenous: getValue(row, 'isIndigenous') === 'true',
        publisher: getValue(row, 'publisher') || null,
        location: getValue(row, 'location') || null,
        publisherUri: getValue(row, 'publisherInst') || null,
        locationUri: getValue(row, 'locationInst') || null,
        metaDataUri: getValue(row, 'metaData') || null,
        wasNamedBy: getValue(row, 'wasNamedBy') || null,
      });
    }

    // Parse Geometry
    const geomUri = getValue(row, 'geomUri');
    const geomWkt = getValue(row, 'geom');
    if (geomUri && geomWkt && !place.geometries.has(geomUri)) {
      const typeMatch = geomWkt.match(/^\s*(\w+)/);
      place.geometries.set(geomUri, {
        uri: geomUri,
        wkt: geomWkt,
        type: typeMatch ? typeMatch[1] : 'Geometry',
      });
    }

    // Parse Cross-border
    const cbUri = getValue(row, 'crossBorderPlace');
    const cbName = getValue(row, 'crossBorderName');
    if (cbUri && cbName && !place.crossBorder.has(cbUri)) {
      const stateMatch = cbUri.match(/\/(ACT|NSW|NT|QLD|SA|TAS|VIC|WA)\//);
      place.crossBorder.set(cbUri, {
        placeUri: cbUri,
        name: cbName,
        state: stateMatch ? stateMatch[1] : 'Unknown',
      });
    }
  }

  // Convert to array output
  const places: MultiValuedPlace[] = [];
  for (const [placeUri, placeData] of placeMap) {
    places.push({
      placeUri,
      identifier: placeData.identifier,
      classification: placeData.classification,
      classificationUri: placeData.classificationUri,
      names: Array.from(placeData.names.values()),
      geometries: Array.from(placeData.geometries.values()),
      crossBorderPlaces: Array.from(placeData.crossBorder.values()),
      sharedGeometryPlaces: [], // Will be populated below
    });
  }

  // Populate sharedGeometryPlaces — each place lists the OTHER places sharing the same geometry
  for (const place of places) {
    place.sharedGeometryPlaces = places
      .filter(p => p.placeUri !== place.placeUri)
      .map(p => ({ placeUri: p.placeUri, name: p.names[0]?.name || '', classification: p.classification }));
  }

  return { places, geometryUri: anchorUri };
}
