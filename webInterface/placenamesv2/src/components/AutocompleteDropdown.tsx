/** Renders the search results dropdown — place cards with classification/location, loading/error/empty states, and keyboard-navigation highlighting (listbox/option roles for aria-activedescendant). */

import type { PlaceDetail } from "../types/place";

interface AutocompleteDropdownProps {
  results: PlaceDetail[];
  isLoading: boolean;
  error: string | null;
  highlightedIndex: number;
  onSelect: (place: PlaceDetail) => void;
  onMouseEnterItem: (index: number) => void;
}

export function AutocompleteDropdown({
  results,
  isLoading,
  error,
  highlightedIndex,
  onSelect,
  onMouseEnterItem,
}: AutocompleteDropdownProps) {
  // Error state
  if (error) {
    return (
      <div className="max-h-72 overflow-y-auto bg-white" role="listbox">
        <div className="px-3 py-3 text-center text-xs text-red-500">
          Search unavailable — please try again
        </div>
      </div>
    );
  }

  // Loading with no results yet
  if (isLoading && results.length === 0) {
    return (
      <div className="max-h-96 overflow-y-auto bg-white" role="listbox">
        <div className="px-4 py-6 text-center text-sm text-gray-500 flex flex-col items-center gap-2">
          <div className="w-5 h-5 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
          Searching places...
        </div>
      </div>
    );
  }

  // No results (not loading, no error)
  if (!isLoading && results.length === 0) {
    return (
      <div className="max-h-96 overflow-y-auto bg-white" role="listbox">
        <div className="px-4 py-4 text-center text-sm text-gray-500">
          No matching places found
        </div>
      </div>
    );
  }

  // Results list
  return (
    <div className="max-h-96 overflow-y-auto bg-white" role="listbox">
      {/* Result count header */}
      <div className="px-3 py-1.5 text-[11px] text-gray-500 bg-gray-50 flex items-center justify-between">
        <span>
          {results.length} result{results.length !== 1 ? "s" : ""}
        </span>
        {isLoading && (
          <div className="w-3 h-3 border border-gray-300 border-t-blue-500 rounded-full animate-spin" />
        )}
      </div>

      {/* Result items */}
      {results.map((place, index) => (
        <button
          key={place.placeUri + index}
          id={`autocomplete-option-${index}`}
          role="option"
          aria-selected={index === highlightedIndex}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onSelect(place)}
          onPointerEnter={() => onMouseEnterItem(index)}
          className={`w-full px-3 py-2.5 text-left transition-colors border-b border-gray-50 last:border-none ${
            index === highlightedIndex ? "bg-blue-50" : "hover:bg-blue-50"
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-gray-800">
              {place.name}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded shrink-0">
              {place.classification}
            </span>
          </div>
          {place.location && (
            <span className="text-xs text-gray-400">{place.location}</span>
          )}
        </button>
      ))}
    </div>
  );
}
