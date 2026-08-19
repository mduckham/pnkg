/** Initializes the MapLibre map, loads the PMTiles data, and sets up point/line/polygon layers. */

import { useCallback, useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";
import { appConfig } from "../config/appConfig";

/** Callback for a map feature click (feature id is queried against SPARQL for details) — pointCoords is set only for a genuine, never-clipped Point (safe to fly to immediately), always null for a Polygon/LineString whose extent needs its real WKT first. */
export type OnFeatureClick = (
  featureId: string,
  lngLat: [number, number],
  pointCoords: [number, number] | null
) => void;

/** Module-level flag to disable map clicks while the search dropdown is open — a plain variable because MapLibre's click handler is registered once and never re-reads React state. */
let mapClicksDisabled = false;

export function setMapClicksDisabled(disabled: boolean) {
  mapClicksDisabled = disabled;
}

/** Adds the PMTiles source and every placenames layer (polygons/lines/points plus selected-feature highlights) to the map — called from useMapInit's `map.on("load", ...)` handler. */
function addPlacenamesLayers(map: maplibregl.Map) {
  map.addSource("placenames", {
    type: "vector",
    url: `pmtiles://${window.location.origin}${appConfig.pmtilesUrl}`,
  });

  // The PMTiles layer is named "placenames" (Nayomi's tippecanoe command used -l placenames).

  // Layer for polygon features. We let fill/line layer rendering handle both Polygon and MultiPolygon.
  map.addLayer({
    id: "placenames-polygons-fill",
    type: "fill",
    source: "placenames",
    "source-layer": "placenames",
    filter: ["==", "$type", "Polygon"],
    paint: {
      "fill-color": "#3388ff",
      "fill-opacity": 0.02,
    },
  });

  // Polygon border lines
  map.addLayer({
    id: "placenames-polygons-line",
    type: "line",
    source: "placenames",
    "source-layer": "placenames",
    filter: ["==", "$type", "Polygon"],
    paint: {
      "line-color": "#555555",
      "line-width": 0.5,
      "line-opacity": 0.6,
    },
  });

  // Layer for LINE features (rivers, roads, ridges)
  map.addLayer({
    id: "placenames-lines",
    type: "line",
    source: "placenames",
    "source-layer": "placenames",
    filter: ["==", "$type", "LineString"],
    paint: {
      "line-color": "#2196f3",
      "line-width": 1.5,
      "line-opacity": 0.7,
    },
  });

  // Layer for POINT features — GKL yellow dots at all zoom levels
  map.addLayer({
    id: "placenames-points",
    type: "circle",
    source: "placenames",
    "source-layer": "placenames",
    filter: ["==", "$type", "Point"],
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 1.5, 6, 2, 8, 3, 12, 4, 16, 5],
      "circle-color": "#FCD12A",
      "circle-stroke-color": "#333333",
      "circle-stroke-width": 0.8,
      "circle-opacity": 0.7,
    },
  });

  // SELECTED point marker — a separate GeoJSON source fed the exact coordinate directly (not a filter against the PMTiles vector layer):
  // PMTiles thins point density at low zoom (tippecanoe feature-dropping), so the selected point's own tile feature can be entirely absent — a dedicated source always renders regardless. See MapView.tsx's showSelectedPoint.
  map.addSource("selected-point", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });

  // Halo — large, low-opacity ring so the point stays findable even zoomed out over a busy basemap; stays a consistent large on-screen size (not much smaller at low zoom) as a "you are here" target.
  map.addLayer({
    id: "selected-point-halo",
    type: "circle",
    source: "selected-point",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 16, 8, 18, 12, 20, 16, 24],
      "circle-color": "#ef4444",
      "circle-opacity": 0.25,
      "circle-stroke-color": "#ef4444",
      "circle-stroke-width": 1,
      "circle-stroke-opacity": 0.4,
    },
  });

  // The dot itself — filled red, clearly "selected"
  map.addLayer({
    id: "selected-point-dot",
    type: "circle",
    source: "selected-point",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 8, 8, 9, 12, 11, 16, 14],
      "circle-color": "#ef4444",
      "circle-stroke-color": "#b91c1c",
      "circle-stroke-width": 2,
      "circle-opacity": 0.95,
    },
  });

  // SELECTED polygon highlight — bold red outline
  map.addLayer({
    id: "placenames-polygons-selected",
    type: "line",
    source: "placenames",
    "source-layer": "placenames",
    filter: ["==", "id", "__none__"],
    paint: {
      "line-color": "#d32f2f",
      "line-width": 4,
      "line-opacity": 0.9,
    },
  });

  // SELECTED line highlight
  map.addLayer({
    id: "placenames-lines-selected",
    type: "line",
    source: "placenames",
    "source-layer": "placenames",
    filter: ["==", "id", "__none__"],
    paint: {
      "line-color": "#d32f2f",
      "line-width": 4,
    },
  });
}

export function useMapInit(
  containerRef: React.RefObject<HTMLDivElement | null>,
  onFeatureClick?: OnFeatureClick
) {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  // Store the callback in a ref so it doesn't cause re-renders
  const onClickRef = useRef(onFeatureClick);
  onClickRef.current = onFeatureClick;

  // Whether the container's size is currently "settled" (no resize pending) — camera moves wait for this; starts true.
  const sizeSettledRef = useRef<{ settled: boolean; waiters: Array<() => void> }>({
    settled: true,
    waiters: [],
  });
  const waitForStableSize = useCallback((): Promise<void> => {
    return new Promise<void>((resolve) => {
      // Already settled: resolve almost immediately (one tick, for React to commit a pending resize-triggering update). Mid-resize: wait for it to finish — avoids a 350ms freeze on every click when the panel is already open.
      if (sizeSettledRef.current.settled) {
        // Micro-delay: gives a same-tick resize-triggering update one frame to flip settled to false.
        requestAnimationFrame(() => {
          if (sizeSettledRef.current.settled) {
            resolve();
          } else {
            // A resize just started — wait for it to finish
            sizeSettledRef.current.waiters.push(resolve);
          }
        });
      } else {
        // Resize already in progress — wait for settle
        sizeSettledRef.current.waiters.push(resolve);
      }
    });
  }, []);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    // Step 1: Register PMTiles protocol with MapLibre
    // This tells MapLibre: "when you see a pmtiles:// URL, use this handler"
    const protocol = new Protocol();
    maplibregl.addProtocol("pmtiles", protocol.tile);

    // Step 2: Create the map
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: appConfig.basemap.default,
      center: appConfig.map.center,
      zoom: appConfig.map.zoom,
      minZoom: appConfig.map.minZoom,
      maxZoom: appConfig.map.maxZoom,
      attributionControl: false, // We add compact attribution manually
      // Left at its default, MapLibre sets up its own internal ResizeObserver that calls resize() unconditionally, including mid-flyTo — exactly what corrupted the animation. Disabling it leaves our own gated logic below as the only path that ever calls resize().
      trackResize: false,
    });

    // Step 3: Add navigation controls — bottom-left
    map.addControl(new maplibregl.NavigationControl(), "bottom-left");
    
    // Collapse attribution by default (user can click to expand)
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

    // Step 3b: Try to get user location and zoom there (moderate zoom, not too close)
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          map.flyTo({
            center: [pos.coords.longitude, pos.coords.latitude],
            zoom: 8,
            duration: 2000,
          });
        },
        () => {
          // Permission denied or error — stay at default Australia view
        },
        { timeout: 5000 }
      );
    }

    // ResizeObserver reference — set up inside load handler, cleaned up on unmount
    let resizeObserver: ResizeObserver | null = null;

    // Step 4: When map loads, add PMTiles source and layers
    map.on("load", () => {
      addPlacenamesLayers(map);

      setMapLoaded(true);

      // Watches the container for size changes and calls map.resize() exactly once at the end of a
      // transition, pinning its pixel size meanwhile — every tried alternative jumped/flickered/juddered.
      const RESIZE_SETTLE_MS = 340;
      if (containerRef.current) {
        let settleTimer: ReturnType<typeof setTimeout> | null = null;
        let pinned = false;
        // observe() always queues one immediate callback with no real change (spec behaviour) — treating it as a resize would needlessly delay the map's very first click. Skip it.
        let firstCallback = true;
        resizeObserver = new ResizeObserver(() => {
          if (firstCallback) {
            firstCallback = false;
            return;
          }
          sizeSettledRef.current.settled = false;

          if (!pinned && containerRef.current) {
            pinned = true;
            const rect = containerRef.current.getBoundingClientRect();
            containerRef.current.style.width = `${rect.width}px`;
            containerRef.current.style.height = `${rect.height}px`;
          }

          if (settleTimer) return; // final call already scheduled for this sequence
          settleTimer = setTimeout(() => {
            settleTimer = null;
            pinned = false;
            if (containerRef.current) {
              containerRef.current.style.width = "";
              containerRef.current.style.height = "";
            }
            map.resize();
            sizeSettledRef.current.settled = true;
            const waiters = sizeSettledRef.current.waiters;
            sizeSettledRef.current.waiters = [];
            waiters.forEach((resolve) => resolve());
          }, RESIZE_SETTLE_MS);
        });
        resizeObserver.observe(containerRef.current);
      }

      // "selected-point-dot" is checked first (priority) — a Point dropped from the tile at this zoom has no clickable "placenames-points" feature, so its visible dot would otherwise fall through to an underlying polygon.
      const clickableLayers = [
        "selected-point-dot",
        "placenames-points",
        "placenames-polygons-fill",
        "placenames-lines",
      ];

      // ===== HOVER TOOLTIP =====
      // Show place name on hover (instant, from PMTiles — no server query needed)
      const tooltip = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        offset: 10,
        className: "place-tooltip",
      });

      for (const layerId of clickableLayers) {
        map.on("mouseenter", layerId, (e) => {
          map.getCanvas().style.cursor = "pointer";
          const feature = e.features?.[0];
          if (feature) {
            const id = feature.properties?.id || "";
            // Extract state + id from a URI like ".../Geometry/Point/WA/WA_100025785".
            const parts = id.split("/");
            const state = parts[parts.length - 2] || "";
            const name = parts[parts.length - 1] || "Place";
            tooltip
              .setLngLat(e.lngLat)
              .setHTML(`<div style="font-size:12px;padding:2px 4px;">${state} — ${decodeURIComponent(name)}</div>`)
              .addTo(map);
          }
        });
        map.on("mouseleave", layerId, () => {
          map.getCanvas().style.cursor = "";
          tooltip.remove();
        });
      }

      // Handle click on any feature
      map.on("click", (e) => {
        // Skip if clicks are disabled (search dropdown is open)
        if (mapClicksDisabled) return;

        // Query all clickable layers at the click point (including search results overlay)
        const allClickable = [...clickableLayers];
        if (map.getLayer("search-results-layer")) {
          allClickable.push("search-results-layer");
        }
        const features = map.queryRenderedFeatures(e.point, {
          layers: allClickable,
        });

        if (features.length > 0) {
          // A point inside its own place's polygon can hit both features at the same pixel — prefer the smaller, more specific point target over whatever hit-test ordering returns. "selected-point-dot" is checked first, since a Point dropped from the tile at this zoom has no PMTiles feature to match at all.
          const selectedDotFeature = features.find((f) => f.layer?.id === "selected-point-dot");
          const pointFeature = features.find((f) => (f.geometry as { type?: string } | undefined)?.type === "Point");
          const feature = selectedDotFeature ?? pointFeature ?? features[0];
          // Log all properties to see what PMTiles gives us

          // The PMTiles file stores the geometry URI in the "id" property
          const featureId = feature.properties?.id;

          if (featureId) {
            // Points highlight via the dedicated selected-point GeoJSON source, fed the feature's own geometry coordinates (more precise than the raw click, which can land a few pixels off at low zoom) — also forwarded to onClickRef so App.tsx can fly there without waiting on SPARQL.
            const geomType = (feature.geometry as { type?: string } | undefined)?.type;
            const pointCoords = geomType === "Point" ? (feature.geometry as unknown as { coordinates: [number, number] }).coordinates : null;
            const pointSource = map.getSource("selected-point") as maplibregl.GeoJSONSource | undefined;
            if (pointSource) {
              pointSource.setData({
                type: "FeatureCollection",
                features: pointCoords ? [{ type: "Feature", geometry: { type: "Point", coordinates: pointCoords }, properties: { id: featureId } }] : [],
              });
            }
            if (map.getLayer("placenames-polygons-selected")) {
              map.setFilter("placenames-polygons-selected", ["==", "id", featureId]);
            }
            if (map.getLayer("placenames-lines-selected")) {
              map.setFilter("placenames-lines-selected", ["==", "id", featureId]);
            }

            // Camera movement is handled by App.tsx's handleFeatureClick from pointCoords/lngLat — this handler only reports what was clicked.
            if (onClickRef.current) {
              onClickRef.current(featureId, [e.lngLat.lng, e.lngLat.lat], pointCoords);
            }
          }
        }
      });
    });

    mapRef.current = map;

    // Cleanup when component unmounts
    return () => {
      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
      }
      map.remove();
      maplibregl.removeProtocol("pmtiles");
      mapRef.current = null;
    };
  }, [containerRef]);

  return { map: mapRef.current, mapLoaded, waitForStableSize };
}
