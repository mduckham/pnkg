/** Map rendering with PMTiles, basemap switching, flying to coordinates, click detection, and hover tooltips. */

import { useRef, useImperativeHandle, forwardRef } from "react";
import maplibregl from "maplibre-gl";
import { useMapInit, type OnFeatureClick } from "../hooks/useMapInit";
import { PANEL_WIDTH_PX } from "./DataPanel";
import { appConfig } from "../config/appConfig";

interface MapViewProps {
  onFeatureClick?: OnFeatureClick;
}

export interface MapViewRef {
  /** Current zoom level, or null before the map has loaded. */
  getZoom: () => number | null;
  /** One id, several (e.g. "show all geometries" highlighting every polygon/line at once), or null to clear. */
  highlightFeature: (featureId: string | string[] | null) => void;
  /** Shows/clears the "you are here" marker(s) at known coordinates, bypassing the PMTiles vector layer (which can drop points at low zoom); each carries its geometry's own id so it's independently clickable — see useMapInit.ts's click handler, which checks this layer first. */
  showSelectedPoint: (points: { id: string; coords: [number, number] }[] | null) => void;
  /** singlePointZoom overrides the zoom for a single Point (App.tsx's recommendedZoom lookup); duration overrides the fly animation length (default 1500ms). No padding option — DataPanel reserves its own width as permanent right padding on every fit instead, since it overlays the map rather than resizing it. */
  fitBounds: (coords: [number, number][], options?: { singlePointZoom?: number; duration?: number }) => void;
  /** Fires once the camera has fully stopped, deferring panel/KG work until after a click's fly animation lands — fires immediately if already stationary, since MapLibre's 'moveend' only fires on future transitions. */
  onceMoveEnd: (callback: () => void) => void;
  filterFeatures: (geometryUris: string[] | null) => void;
  showSearchResults: (results: { id: string; coords: [number, number] }[] | null) => void;
  showPopup: (lng: number, lat: number, html: string) => void;
  hidePopup: () => void;
}

export const MapView = forwardRef<MapViewRef, MapViewProps>(
  function MapView({ onFeatureClick }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const { map, mapLoaded, waitForStableSize } = useMapInit(containerRef, onFeatureClick);

    // Expose highlightFeature and friends so parent can control the map
    useImperativeHandle(ref, () => ({
      getZoom: () => map?.getZoom() ?? null,
      highlightFeature: (featureId: string | string[] | null) => {
        // Polygon/line only — points highlight separately via showSelectedPoint, since they need an exact coordinate the vector-tile filter can't reliably provide at low zoom.
        if (!map) return;
        const ids = featureId == null ? ["__none__"] : Array.isArray(featureId) ? featureId : [featureId];
        const filter = ["in", "id", ...ids] as unknown as maplibregl.FilterSpecification;
        if (map.getLayer("placenames-polygons-selected")) {
          map.setFilter("placenames-polygons-selected", filter);
        }
        if (map.getLayer("placenames-lines-selected")) {
          map.setFilter("placenames-lines-selected", filter);
        }
      },
      showSelectedPoint: (points: { id: string; coords: [number, number] }[] | null) => {
        if (!map) return;
        const source = map.getSource("selected-point") as maplibregl.GeoJSONSource | undefined;
        if (!source) return;
        source.setData({
          type: "FeatureCollection",
          features: (points ?? []).map((p) => ({ type: "Feature", geometry: { type: "Point", coordinates: p.coords }, properties: { id: p.id } })),
        });
      },
      fitBounds: (coords: [number, number][], options?: { singlePointZoom?: number; duration?: number }) => {
        // A single coordinate has no bounding box to fit, so go to a fixed zoom instead of a zero-size fitBounds (unpredictable in MapLibre) — defaults to 12 if the caller omits singlePointZoom; App.tsx's fitAllGeometries passes an adaptive, density-based zoom instead.
        if (!map || coords.length === 0) return;
        const dur = options?.duration ?? 1500;
        // DataPanel overlays the map rather than resizing it, so every fit reserves its width as padding itself, unconditionally, so the selected place centers in the space that stays uncovered once the panel slides in.
        const padding = { top: 0, bottom: 0, left: 0, right: PANEL_WIDTH_PX };
        if (coords.length === 1) {
          waitForStableSize().then(() => {
            map.flyTo({ center: coords[0], zoom: options?.singlePointZoom ?? 12, duration: dur, padding });
          });
          return;
        }
        // Polygons/lines zoom dynamically from their own bbox; maxZoom is only a ceiling for tiny shapes (raised from 14, which cut small MultiPolygons off early). It never bounds zooming OUT, though — a bbox spanning far-apart disconnected parts can zoom out to something disorienting for "one place," so cameraForBounds previews the natural fit and floors it at geometryFitMinZoom first, falling back to a plain fitBounds if that can't be computed.
        const bounds = coords.reduce(
          (b, c) => b.extend(c),
          new maplibregl.LngLatBounds(coords[0], coords[0])
        );
        const fitPadding = { top: 50, bottom: 50, left: 50, right: 50 + PANEL_WIDTH_PX };
        waitForStableSize().then(() => {
          const camera = map.cameraForBounds(bounds, { padding: fitPadding, maxZoom: 17 });
          if (camera && camera.center && camera.zoom != null) {
            map.easeTo({
              center: camera.center,
              zoom: Math.max(camera.zoom, appConfig.map.geometryFitMinZoom),
              duration: dur,
              padding: fitPadding,
            });
          } else {
            map.fitBounds(bounds, { padding: fitPadding, maxZoom: 17, duration: dur });
          }
        });
      },
      onceMoveEnd: (callback: () => void) => {
        if (!map || !map.isMoving()) {
          callback();
          return;
        }
        map.once("moveend", callback);
      },
      filterFeatures: (geometryUris: string[] | null) => {
        if (!map) return;
        const layers = ["placenames-points", "placenames-polygons-fill", "placenames-polygons-line", "placenames-lines"];
        if (!geometryUris || geometryUris.length === 0) {
          // Clear filter — show all features
          for (const layerId of layers) {
            if (map.getLayer(layerId)) {
              const geomType = layerId.includes("points") ? "Point" : layerId.includes("line") ? (layerId === "placenames-lines" ? "LineString" : "Polygon") : "Polygon";
              map.setFilter(layerId, ["==", "$type", geomType]);
            }
          }
        } else {
          // Filter to only show matching features
          // Legacy filter: ["in", "property_name", value1, value2, ...]
          const inFilter: any = ["in", "id", ...geometryUris];
          for (const layerId of layers) {
            if (map.getLayer(layerId)) {
              const geomType = layerId.includes("points") ? "Point" : layerId.includes("line") ? (layerId === "placenames-lines" ? "LineString" : "Polygon") : "Polygon";
              map.setFilter(layerId, ["all", ["==", "$type", geomType], inFilter] as any);
            }
          }
        }
      },
      showSearchResults: (results: { id: string; coords: [number, number] }[] | null) => {
        if (!map) return;
        
        // Remove existing search results layer/source
        if (map.getLayer("search-results-layer")) map.removeLayer("search-results-layer");
        if (map.getSource("search-results")) map.removeSource("search-results");
        
        // No more placenames-points layer to dim
        
        if (!results || results.length === 0) return;
        
        // Build GeoJSON from search results
        const geojson = {
          type: "FeatureCollection" as const,
          features: results.map(r => ({
            type: "Feature" as const,
            properties: { id: r.id },
            geometry: { type: "Point" as const, coordinates: r.coords }
          }))
        };
        
        // Add as a new source + layer
        map.addSource("search-results", { type: "geojson", data: geojson });
        map.addLayer({
          id: "search-results-layer",
          type: "circle",
          source: "search-results",
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 2, 6, 3, 8, 4, 12, 5, 16, 6],
            "circle-color": "#FCD12A",
            "circle-stroke-color": "#000000",
            "circle-stroke-width": 2,
            "circle-opacity": 1,
          }
        });
        
        // Make blue dots clickable — trigger same handler as red dots
        map.on("mouseenter", "search-results-layer", () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", "search-results-layer", () => {
          map.getCanvas().style.cursor = "";
        });
      },
      showPopup: (lng: number, lat: number, html: string) => {
        if (!map) return;
        // Remove existing place popup
        const existing = document.querySelector('.place-info-popup');
        if (existing) existing.remove();
        
        new maplibregl.Popup({ className: 'place-info-popup', closeButton: true, maxWidth: '280px', offset: 15 })
          .setLngLat([lng, lat])
          .setHTML(html)
          .addTo(map);
      },
      hidePopup: () => {
        if (!map) return;
        const existing = document.querySelector('.place-info-popup .maplibregl-popup-close-button');
        if (existing) (existing as HTMLElement).click();
      },
    }), [map, waitForStableSize]);

    return (
      <div className="relative w-full h-full overflow-hidden">
        <div ref={containerRef} className="w-full h-full" />

        {!mapLoaded && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
            <p className="text-gray-500 text-sm">Loading map...</p>
          </div>
        )}

      </div>
    );
  }
);
