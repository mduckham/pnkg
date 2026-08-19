/** Top-level app: search bar, resizable map/knowledge-graph split, and the unified detail panel. */

import { useState, useCallback, useRef, useEffect } from "react";
import { MapView, type MapViewRef } from "./components/MapView";
import { SearchBar } from "./components/SearchBar";
import { DataPanel } from "./components/DataPanel";
import { GraphPanel, type GraphPanelRef } from "./components/GraphPanel";
import { NearbyPanel } from "./components/NearbyPanel";
import { ResizableSplit } from "./components/ResizableSplit";
import { appConfig } from "./config/appConfig";
import { searchPlaces, getPlaceDetails } from "./services/placeService";
import { getRecommendedZoom, preloadRecommendedZoomService } from "./services/recommendedZoomService";
import { querySparql } from "./services/sparqlService";
import { getCoordinatesFromWkt, getAllCoordinatesFromWkt } from "./services/wktParser";
import { useMapGraphSync } from "./hooks/useMapGraphSync";
import { useMultiValuedPlace } from "./hooks/useMultiValuedPlace";
import { useSelectedGraphNode } from "./hooks/useSelectedGraphNode";
import type { PlaceDetail, NearbyPlace, GeometryQueryResult, MultiValuedPlace } from "./types/place";
import type { GraphData, GraphNode } from "./types/graph";

/** Builds the single-point marker payload for showSelectedPoint on a Point geometry switch — null for any other type, clearing the marker. */
function pointMarkerFor(uri: string, wkt: string): { id: string; coords: [number, number] }[] | null {
  if (!wkt.trim().toUpperCase().startsWith('POINT')) return null;
  const coords = getCoordinatesFromWkt(wkt);
  return coords ? [{ id: uri, coords }] : null;
}

/** Converts an already-fetched MultiValuedPlace into a PlaceDetail for "Also at this
 *  location" navigation — no second round-trip needed, just reshaping data in hand. */
function multiValuedPlaceToPlaceDetail(mvPlace: MultiValuedPlace, fallbackGeometryUri: string): PlaceDetail {
  const primaryName = mvPlace.names[0];
  const geom = mvPlace.geometries.find((g) => g.type.toUpperCase() === 'POINT') ?? mvPlace.geometries[0];
  return {
    placeUri: mvPlace.placeUri,
    name: primaryName?.name ?? 'Unknown',
    classification: mvPlace.classification,
    status: primaryName?.status ?? '',
    dateGazetted: primaryName?.dateGazetted ?? null,
    location: primaryName?.location ?? '',
    publisher: primaryName?.publisher ?? '',
    isIndigenous: primaryName?.isIndigenous ?? false,
    geometry: geom?.wkt ?? '',
    placeNameUri: primaryName?.uri ?? '',
    crossBorderPlace: mvPlace.crossBorderPlaces[0]?.placeUri ?? null,
    webPage: null,
    geometryUri: geom?.uri ?? fallbackGeometryUri,
  };
}

function App() {
  const [selectedPlace, setSelectedPlace] = useState<PlaceDetail | null>(null);
  // Deliberately separate from selectedPlace, set synchronously on click, so useMultiValuedPlace can start fetching immediately instead of waiting for selectedPlace to resolve.
  const [activeSelectionGeometryUri, setActiveSelectionGeometryUri] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSearchingPlaces, setIsSearchingPlaces] = useState(false);
  const [searchResults, setSearchResults] = useState<PlaceDetail[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [showNearby, setShowNearby] = useState(false);
  const [showDataPanel, setShowDataPanel] = useState(false);
  const [, setSplitPercent] = useState(67);
  const [highlightNodeIds, setHighlightNodeIds] = useState<string[]>([]);
  const mapRef = useRef<MapViewRef>(null);
  const graphPanelRef = useRef<GraphPanelRef>(null);

  // Absorbs getRecommendedZoom's PMTiles-header cold start during idle page load.
  useEffect(() => {
    preloadRecommendedZoomService();
  }, []);

  // Driven by activeSelectionGeometryUri, not selectedPlace?.geometryUri, so a new
  // selection clears/refetches this immediately.
  const { data: multiValuedData, isLoading: mvLoading } = useMultiValuedPlace(activeSelectionGeometryUri ?? undefined);

  // Lifted out of GraphPanel so the unified data panel can read it too.
  const {
    selectedNode: selectedGraphNode,
    selectNode: selectGraphNode,
  } = useSelectedGraphNode();

  // Shared wrapper around MapView's fitBounds so every "move the map" call site gets the same, immediately-correct zoom — recommendedZoom is precomputed off the PMTiles file, no async correction (and no network-timing-dependent zoom tier) needed.
  const fitBoundsAdaptive = useCallback((coords: [number, number][], uri: string | null) => {
    if (coords.length === 0) return;
    if (coords.length === 1 && uri) {
      getRecommendedZoom(uri, coords[0]).then((zoom) => {
        mapRef.current?.fitBounds(coords, { singlePointZoom: zoom ?? appConfig.map.fallbackZoom });
      });
      return;
    }
    mapRef.current?.fitBounds(coords);
  }, []);

  // Fits the viewport to ALL of a place's geometries, deduped by URI (a shared geometry
  // appears once per sharing place, but should only count once here).
  const fitAllGeometries = useCallback((data: GeometryQueryResult | null) => {
    if (!data) return;
    const allGeoms = data.places.flatMap((p) => p.geometries);
    const uniqueGeoms = Array.from(new Map(allGeoms.map((g) => [g.uri, g])).values());
    const allCoords: [number, number][] = [];
    for (const geom of uniqueGeoms) allCoords.push(...getAllCoordinatesFromWkt(geom.wkt));
    // A place whose entire geometry is a single Point is the recommendedZoom case;
    // anything else sizes itself from the real bounding box.
    const singlePointUri =
      uniqueGeoms.length === 1 && uniqueGeoms[0].type.toUpperCase() === "POINT" ? uniqueGeoms[0].uri : null;
    fitBoundsAdaptive(allCoords, singlePointUri);
  }, [fitBoundsAdaptive]);

  // Default view is NOT fired automatically on multiValuedData change (caused a "zoom 4s after info appears" problem) — each selection handler triggers its own zoom; this effect exists only for showDefaultPointMarker and the reset button.

  // Kept in sync with the current place reactively, via showSelectedPoint not highlightFeature's vector-tile filter — PMTiles drops point features at low zoom, exactly when the point matters most.
  const showDefaultPointMarker = useCallback((data: GeometryQueryResult | null) => {
    if (!data) {
      mapRef.current?.showSelectedPoint(null);
      return;
    }
    // Every Point geometry the place has, each independently clickable via its own uri.
    const points = data.places
      .flatMap((p) => p.geometries)
      .filter((g) => g.type.toUpperCase() === 'POINT')
      .map((g) => {
        const coords = getCoordinatesFromWkt(g.wkt);
        return coords ? { id: g.uri, coords } : null;
      })
      .filter((p): p is { id: string; coords: [number, number] } => p !== null);
    mapRef.current?.showSelectedPoint(points.length > 0 ? points : null);
  }, []);

  // Companion to showDefaultPointMarker — highlights every non-Point geometry's outline at
  // once, so a place with both a Point and a shape shows both from the moment it's selected.
  const showDefaultShapeOutline = useCallback((data: GeometryQueryResult | null) => {
    const nonPointUris = data?.places
      .flatMap((p) => p.geometries)
      .filter((g) => g.type.toUpperCase() !== 'POINT')
      .map((g) => g.uri) ?? [];
    mapRef.current?.highlightFeature(nonPointUris.length > 0 ? nonPointUris : null);
  }, []);

  useEffect(() => {
    showDefaultPointMarker(multiValuedData);
    showDefaultShapeOutline(multiValuedData);
  }, [multiValuedData, showDefaultPointMarker, showDefaultShapeOutline]);

  // "Reset view" control — reverts to the resting "show everything" state (every geometry
  // highlighted at once), undoing a manual Point/MultiPolygon selector click, plus re-fits the camera.
  const handleResetMapView = useCallback(() => {
    fitAllGeometries(multiValuedData);
    showDefaultPointMarker(multiValuedData);
    showDefaultShapeOutline(multiValuedData);
  }, [multiValuedData, fitAllGeometries, showDefaultPointMarker, showDefaultShapeOutline]);

  // Map click — camera moves first, independent of any network call; Place Info/KG fetch concurrently but only reveal once the camera settles. pointCoords is safe to fly to immediately (never clipped by tile boundaries, unlike a polygon's bounds).
  const handleFeatureClick = useCallback((featureId: string, lngLat: [number, number], pointCoords: [number, number] | null) => {
    setShowResults(false);
    mapRef.current?.showSearchResults(null);
    mapRef.current?.highlightFeature(featureId);

    // Clears the previous place immediately — featureId is already the new geometry URI, so useMultiValuedPlace reacts instantly (cascading to clear the canvas) while the reveal still waits on getPlaceDetails below.
    setActiveSelectionGeometryUri(featureId);
    setIsLoading(true);

    // A Point waits for recommendedZoom then issues exactly one flyTo — a second mid-animation call (an earlier interim-then-correct approach) made MapLibre recompute its easing curve as a stutter. A Polygon/LineString needs the real WKT, so gets an interim flight corrected once settled.
    const flyTarget = pointCoords ?? lngLat;
    if (pointCoords) {
      getRecommendedZoom(featureId, pointCoords).then((zoom) => {
        mapRef.current?.fitBounds([flyTarget], { singlePointZoom: zoom ?? appConfig.map.fallbackZoom });
      });
    } else {
      mapRef.current?.fitBounds([flyTarget], { singlePointZoom: appConfig.map.fallbackZoom });
    }

    // Fetched now (ready well before the fly animation finishes) but not revealed until
    // the camera has actually stopped moving.
    getPlaceDetails(featureId)
      .then((place) => {
        mapRef.current?.onceMoveEnd(() => {
          if (place) {
            setSelectedPlace(place);
            // A polygon's true extent is only known now — its tile-clipped click
            // geometry isn't a valid bbox source, so this is the first point it can fit to.
            if (place.geometry) {
              const coords = getAllCoordinatesFromWkt(place.geometry);
              if (coords.length > 1) fitBoundsAdaptive(coords, null);
            }
          } else {
            setSelectedPlace({
              placeUri: featureId, name: "Unknown Place", classification: "Unknown",
              status: "", dateGazetted: null, location: "", publisher: "",
              isIndigenous: false, geometry: "", placeNameUri: "",
              crossBorderPlace: null, webPage: null, geometryUri: featureId,
            });
          }
          setShowDataPanel(true);
          setIsLoading(false);
        });
      })
      .catch(() => {
        mapRef.current?.onceMoveEnd(() => setIsLoading(false));
      });
  }, [fitBoundsAdaptive]);

  // Search
  const handleSearch = useCallback((query: string, filters: SearchFilters) => {
    // Allow empty search if filters are active
    const hasFilters = filters.exactMatch || filters.indigenousOnly || filters.crossBorder || filters.states.length < 8;
    if (!query.trim() && !hasFilters) return;
    setIsSearchingPlaces(true);
    setShowResults(false);
    searchPlaces(query, filters.states, filters.exactMatch, filters.indigenousOnly, filters.crossBorder)
      .then((results) => {
        setSearchResults(results);
        setShowResults(true);
        setSelectedPlace(null);
        setIsSearchingPlaces(false);

        // Show search results as dynamic GeoJSON overlay (blue dots)
        const searchDots: { id: string; coords: [number, number] }[] = [];
        const fitCoords: [number, number][] = [];
        for (const r of results) {
          if (r.geometry) {
            const c = getCoordinatesFromWkt(r.geometry);
            if (c) {
              fitCoords.push(c);
              if (r.geometryUri) searchDots.push({ id: r.geometryUri, coords: c });
            }
          }
        }
        if (searchDots.length > 0) {
          mapRef.current?.showSearchResults(searchDots);
        }

        // A single result is exactly the recommendedZoom case, not a "fit many" one.
        const singleResultUri = results.length === 1 && fitCoords.length === 1 ? results[0].geometryUri : null;
        fitBoundsAdaptive(fitCoords, singleResultUri);
      })
      .catch(() => setIsSearchingPlaces(false));
  }, [fitBoundsAdaptive]);

  // Select search result — fetch full details
  const handleSelectResult = useCallback((place: PlaceDetail) => {
    setShowResults(false);
    setShowDataPanel(true);
    mapRef.current?.showSearchResults(null);
    if (place.geometry) {
      const coords = getCoordinatesFromWkt(place.geometry);
      if (coords) fitBoundsAdaptive([coords], place.geometryUri);
    }
    if (place.geometryUri) {
      mapRef.current?.highlightFeature(place.geometryUri);
      setActiveSelectionGeometryUri(place.geometryUri);
      setIsLoading(true);
      getPlaceDetails(place.geometryUri)
        .then((fullPlace) => {
          // getPlaceDetails picks an arbitrary row for name/placeNameUri, which would silently overwrite the specific name clicked — `place` still has the correct one from searchPlaces.
          const merged = fullPlace && place.placeNameUri
            ? { ...fullPlace, name: place.name, placeNameUri: place.placeNameUri }
            : fullPlace;
          setSelectedPlace(merged || place);
          setIsLoading(false);
        })
        .catch(() => {
          setSelectedPlace(place);
          setIsLoading(false);
        });
    } else {
      setActiveSelectionGeometryUri(null);
      setSelectedPlace(place);
    }
  }, [fitBoundsAdaptive]);

  // Close panel — hides panel but keeps place selected (graph stays active)
  const handleClosePanel = useCallback(() => {
    setShowDataPanel(false);
  }, []);

  // Nearby
  const handleOpenNearby = useCallback(() => setShowNearby(true), []);
  const handleCloseNearby = useCallback(() => setShowNearby(false), []);
  const handleSelectNearby = useCallback((nearby: NearbyPlace) => {
    setShowNearby(false);
    setShowDataPanel(true);
    if (nearby.geometry) {
      const coords = getCoordinatesFromWkt(nearby.geometry);
      if (coords) fitBoundsAdaptive([coords], nearby.geometryUri);
    }
    if (nearby.geometryUri) {
      mapRef.current?.highlightFeature(nearby.geometryUri);
      setActiveSelectionGeometryUri(nearby.geometryUri);
      setIsLoading(true);
      getPlaceDetails(nearby.geometryUri)
        .then((place) => {
          if (place) setSelectedPlace(place);
          setIsLoading(false);
        })
        .catch(() => setIsLoading(false));
    }
  }, [fitBoundsAdaptive]);

  // Map-Graph sync with lock/freeze mechanism
  const {
    syncState,
    toggleGraphLock,
    activeGraphData,
    activePlace,
    activeGraphPlaceName,
  } = useMapGraphSync(selectedPlace, multiValuedData);

  // wasNamedBy is now fetched in the initial SPARQL query, so this just passes activeGraphData through.
  const [enrichedGraphData, setEnrichedGraphData] = useState<GraphData | null>(null);

  useEffect(() => {
    setEnrichedGraphData(activeGraphData);
  }, [activeGraphData]);

  // Highlight only — no flyTo, the map should not move on a graph node click.
  const handleGraphNodeClick = useCallback((node: GraphNode) => {
    if (node.type !== "place" && node.type !== "geometry") return;

    const place = activePlace;
    if (!place?.geometry) return;

    if (place.geometryUri) mapRef.current?.highlightFeature(place.geometryUri);
  }, [activePlace]);

  // Handles both "Also at this location" links (same geometry, different place) and
  // Cross-border links (different geometry, tried as a geometry URI, best effort).
  const handlePanelNavigate = useCallback((targetUri: string) => {
    setIsLoading(true);
    setShowDataPanel(true);
    mapRef.current?.showSearchResults(null);

    // "Also at this location" data is already fully fetched — switching primary just picks a different entry, and is the only option here since getPlaceDetails only resolves a geometry URI, not a place URI.
    const sharedPlace = multiValuedData?.places.find((p) => p.placeUri === targetUri);
    if (sharedPlace) {
      const place = multiValuedPlaceToPlaceDetail(sharedPlace, multiValuedData!.geometryUri);
      setSelectedPlace(place);
      if (place.geometry) {
        const coords = getCoordinatesFromWkt(place.geometry);
        if (coords) fitBoundsAdaptive([coords], place.geometryUri);
      }
      if (place.geometryUri) mapRef.current?.highlightFeature(place.geometryUri);
      setIsLoading(false);
      return;
    }

    // Otherwise a cross-border link — try the URI as a geometry URI.
    getPlaceDetails(targetUri)
      .then((place) => {
        if (place) {
          setSelectedPlace(place);
          if (place.geometry) {
            const coords = getCoordinatesFromWkt(place.geometry);
            if (coords) fitBoundsAdaptive([coords], place.geometryUri);
          }
          if (place.geometryUri) mapRef.current?.highlightFeature(place.geometryUri);
        } else {
          // Not resolvable either — fly back to the current location rather than doing nothing.
          if (selectedPlace?.geometry) {
            const coords = getCoordinatesFromWkt(selectedPlace.geometry);
            if (coords) fitBoundsAdaptive([coords], selectedPlace.geometryUri);
          }
        }
        setIsLoading(false);
      })
      .catch(() => setIsLoading(false));
  }, [selectedPlace, multiValuedData, fitBoundsAdaptive]);

  // Fits the map to the full extent of the geometry, not just its first point.
  const handleGeometrySwitch = useCallback((newGeometryUri: string, wkt: string) => {
    const switchCoords = getAllCoordinatesFromWkt(wkt);
    fitBoundsAdaptive(switchCoords, switchCoords.length === 1 ? newGeometryUri : null);
    mapRef.current?.highlightFeature(newGeometryUri);
    // Only shows while a Point is actually the one selected, so it doesn't sit redundantly
    // next to whatever polygon/line is now highlighted instead.
    mapRef.current?.showSelectedPoint(pointMarkerFor(newGeometryUri, wkt));
  }, [fitBoundsAdaptive]);

  // Geometry-select events from GraphPanel — fit the map to that geometry's full extent.
  useEffect(() => {
    const handler = (ev: any) => {
      const geo = ev.detail?.geometryUri;
      if (!geo) return;

      mapRef.current?.highlightFeature(geo);

      const localWkt = multiValuedData?.places
        ?.flatMap(p => p.geometries)
        .find(g => g.uri === geo)?.wkt;

      if (localWkt) {
        const localCoords = getAllCoordinatesFromWkt(localWkt);
        fitBoundsAdaptive(localCoords, localCoords.length === 1 ? geo : null);
        mapRef.current?.showSelectedPoint(pointMarkerFor(geo, localWkt));
        return;
      }

      // Not part of the originally-loaded place's geometries (e.g. a cross-border place's
      // own geometry, revealed by expanding that node) — fetch its WKT directly.
      querySparql(
        `PREFIX geo: <http://www.opengis.net/ont/geosparql#>
SELECT ?wkt WHERE { <${geo}> geo:asWKT ?wkt } LIMIT 1`
      )
        .then((result) => {
          const wkt = result.results?.bindings?.[0]?.wkt?.value;
          if (wkt) {
            const remoteCoords = getAllCoordinatesFromWkt(wkt);
            fitBoundsAdaptive(remoteCoords, remoteCoords.length === 1 ? geo : null);
            mapRef.current?.showSelectedPoint(pointMarkerFor(geo, wkt));
          }
        })
        .catch(() => { /* map just won't move — highlight above still applied */ });
    };
    window.addEventListener('graph:geometrySelect', handler as EventListener);
    return () => window.removeEventListener('graph:geometrySelect', handler as EventListener);
  }, [multiValuedData, fitBoundsAdaptive]);

  // "I Feel Lucky" — a random place via a random SPARQL offset.
  const handleFeelLucky = useCallback(() => {
    setIsLoading(true);
    const randomOffset = Math.floor(Math.random() * 5000);
    querySparql(`
      PREFIX pn: <http://linked.data.gov.au/def/placenames/>
      PREFIX geo: <http://www.opengis.net/ont/geosparql#>
      SELECT ?place ?name ?geomUri ?wkt WHERE {
        ?place pn:hasPlaceName ?plnm .
        ?plnm pn:name ?name .
        ?place geo:hasGeometry ?geomUri .
        ?geomUri geo:asWKT ?wkt .
        FILTER(CONTAINS(STR(?geomUri), "/Point/"))
      }
      LIMIT 1
      OFFSET ${randomOffset}
    `)
      .then((result) => {
        const b = result.results?.bindings?.[0];
        if (b?.geomUri?.value) {
          const coords = b.wkt?.value ? getCoordinatesFromWkt(b.wkt.value) : null;
          // Query already filters to /Point/, so pass as pointCoords for an immediate fly.
          handleFeatureClick(b.geomUri.value, coords ?? [0, 0], coords);
        } else {
          setIsLoading(false);
        }
      })
      .catch(() => setIsLoading(false));
  }, [handleFeatureClick]);

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-gray-900">
      {/* Header */}
      <header className="bg-[#1a2332] text-white px-4 py-2 flex items-center shadow-md z-20 relative">
        <div className="flex items-center gap-2 mr-4">
          <a href={appConfig.logoUrl} target="_blank" rel="noopener noreferrer" className="hover:opacity-80 transition-opacity">
            <img src="/gkl-trans.png" alt="GKL" className="w-7 h-7 object-contain" />
          </a>
          <span className="text-xs font-medium text-gray-400">@RMIT</span>
        </div>
        <h1 className="flex-1 text-center text-sm font-semibold tracking-wide">{appConfig.title}</h1>
        <a href={appConfig.aboutUrl} target="_blank" rel="noopener noreferrer" className="text-xs px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/20 transition-colors">About</a>
      </header>

      {/* Main — Resizable split: Map (left) + Graph (right) */}
      <main className="flex-1 min-h-0 relative">
        <ResizableSplit
          initialSplit={67}
          minLeft={35}
          minRight={15}
          onSplitChange={setSplitPercent}
          left={
            <div className="relative w-full h-full flex flex-row">
              <div className="relative flex-1 min-w-0 h-full overflow-hidden">
                <MapView
                  ref={mapRef}
                  onFeatureClick={handleFeatureClick}
                />
                {/* Search bar — floats over the map */}
                <SearchBar
                  onSearch={handleSearch}
                  results={showResults ? searchResults : []}
                  onSelectResult={handleSelectResult}
                  isSearchLoading={isSearchingPlaces}
                  onDismissResults={() => setShowResults(false)}
                />
              </div>
              {/* Fixed-width, full-height slide-out docked between the map and the graph. */}
              <DataPanel
                place={selectedPlace}
                multiValuedData={multiValuedData}
                onClose={handleClosePanel}
                isLoading={isLoading || mvLoading}
                isOpen={showDataPanel}
                onHighlightNodes={setHighlightNodeIds}
                onNavigateToPlace={handlePanelNavigate}
                onGeometrySwitch={handleGeometrySwitch}
                onSelectNode={selectGraphNode}
                selectedGraphNode={selectedGraphNode}
                onExpandCrossBorderNode={(uri) => graphPanelRef.current?.expandNodeByUri(uri)}
              />
            </div>
          }
          right={
            <GraphPanel
              ref={graphPanelRef}
              data={enrichedGraphData}
              placeName={activeGraphPlaceName}
              placeUri={selectedPlace?.placeUri}
              geometryUri={selectedPlace?.geometryUri}
              placeNameUri={selectedPlace?.placeNameUri}
              onNodeClick={handleGraphNodeClick}
              isLocked={syncState.graphLocked}
              onToggleLock={toggleGraphLock}
              isLoading={isLoading || mvLoading}
              highlightNodeIds={highlightNodeIds}
              onFeelLucky={handleFeelLucky}
              onResetMapView={handleResetMapView}
              onViewNearby={handleOpenNearby}
              selectedNodeId={selectedGraphNode?.id ?? null}
              onNodeSelect={selectGraphNode}
            />
          }
        />

        {/* Nearby panel */}
        {showNearby && selectedPlace && (
          <NearbyPanel
            originWkt={selectedPlace.geometry}
            originName={selectedPlace.name}
            onClose={handleCloseNearby}
            onSelectNearby={handleSelectNearby}
          />
        )}
      </main>
    </div>
  );
}

export interface SearchFilters {
  exactMatch: boolean;
  indigenousOnly: boolean;
  crossBorder: boolean;
  states: string[];
}

export default App;
