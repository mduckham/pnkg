/** Shows places near the selected place, grouped by classification, with a distance slider. */

import { useState, useCallback, useEffect } from "react";
import { getNearbyPlaces } from "../services/placeService";
import { useMediaQuery } from "../hooks/useMediaQuery";
import type { NearbyPlace } from "../types/place";

interface NearbyPanelProps {
  /** WKT point of the origin place (center of search) */
  originWkt: string;
  /** Name of the origin place */
  originName: string;
  /** Close the panel */
  onClose: () => void;
  /** When a nearby place is clicked */
  onSelectNearby: (place: NearbyPlace) => void;
}

export function NearbyPanel({ originWkt, originName, onClose, onSelectNearby }: NearbyPanelProps) {
  const [distance, setDistance] = useState(3);
  const [places, setPlaces] = useState<NearbyPlace[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const isMobile = useMediaQuery("(max-width: 767px)");

  // Fetch nearby places whenever distance changes
  const fetchNearby = useCallback(() => {
    if (!originWkt) return;
    setIsLoading(true);
    getNearbyPlaces(originWkt, distance)
      .then((results) => {
        setPlaces(results);
        setIsLoading(false);
      })
      .catch(() => {
        setIsLoading(false);
      });
  }, [originWkt, distance]);

  // Auto-fetch on mount and when distance changes
  useEffect(() => {
    fetchNearby();
  }, [fetchNearby]);

  // Group places by classification
  const grouped = places.reduce<Record<string, NearbyPlace[]>>((acc, place) => {
    const key = place.classification || "Other";
    if (!acc[key]) acc[key] = [];
    acc[key].push(place);
    return acc;
  }, {});

  const sortedCategories = Object.keys(grouped).sort();

  return (
    <aside className={isMobile
      ? "absolute bottom-0 left-0 right-0 max-h-[75vh] bg-white shadow-2xl z-30 flex flex-col rounded-t-xl"
      : "absolute top-0 right-0 bottom-0 w-95 max-w-[85vw] bg-white shadow-2xl z-30 flex flex-col"
    }>
      {/* Header */}
      <div className={`flex items-center justify-between px-4 py-2.5 border-b border-gray-100 bg-gray-50/80 ${isMobile ? "rounded-t-xl" : ""}`}>
        <div>
          <h2 className="text-sm font-semibold text-gray-700">Nearby Places</h2>
          <p className="text-xs text-gray-400 mt-0.5">around {originName}</p>
        </div>
        <button
          onClick={onClose}
          className="w-11 h-11 flex items-center justify-center rounded-md hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
          aria-label="Close nearby panel"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Distance slider */}
      <div className="px-5 py-4 border-b border-gray-100">
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-medium text-gray-600">Search radius</label>
          <span className="text-sm font-semibold text-blue-600">{distance} km</span>
        </div>
        <input
          type="range"
          min={1}
          max={10}
          step={1}
          value={distance}
          onChange={(e) => setDistance(Number(e.target.value))}
          className="w-full accent-blue-500"
        />
        <div className="flex justify-between text-[10px] text-gray-400 mt-1">
          <span>1 km</span>
          <span>10 km</span>
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="flex flex-col items-center justify-center h-32 gap-2">
            <div className="w-5 h-5 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
            <span className="text-xs text-gray-400">Finding nearby places...</span>
          </div>
        )}

        {!isLoading && places.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 text-center px-6">
            <span className="text-2xl mb-2">🔍</span>
            <p className="text-sm text-gray-500">No places found within {distance} km</p>
            <p className="text-xs text-gray-400 mt-1">Try increasing the radius</p>
          </div>
        )}

        {!isLoading && places.length > 0 && (
          <div className="p-4">
            <p className="text-xs text-gray-500 mb-3">
              Found <span className="font-semibold text-gray-700">{places.length}</span> place
              {places.length !== 1 ? "s" : ""} in {sortedCategories.length} categor
              {sortedCategories.length !== 1 ? "ies" : "y"}
            </p>

            <div className="space-y-4">
              {sortedCategories.map((category) => (
                <div key={category}>
                  {/* Category header */}
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-xs font-semibold text-gray-700">{category}</span>
                    <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded-full">
                      {grouped[category].length}
                    </span>
                  </div>

                  {/* Places in this category */}
                  <div className="space-y-0.5">
                    {grouped[category].map((place, i) => (
                      <button
                        key={place.placeUri + i}
                        onClick={() => onSelectNearby(place)}
                        className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-blue-50 rounded-lg transition-colors flex items-center gap-2"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
                        {place.name}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
