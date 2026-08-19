/** Two dropdown modes, chosen by `showingSuggestions`: un-debounced name suggestions while typing (click just fills the box) vs. rich, select/navigate place cards after Enter/Search — plus an expandable filter panel, keyboard nav, and ARIA. */

import { useState, useCallback, useRef, useEffect, useReducer } from "react";
import { appConfig } from "../config/appConfig";
import { fetchNameSuggestions } from "../services/placeService";
import { setMapClicksDisabled } from "../hooks/useMapInit";
import { FilterPanel } from "./FilterPanel";
import { AutocompleteDropdown } from "./AutocompleteDropdown";
import type { PlaceDetail } from "../types/place";
import type { SearchFilters } from "../App";

// --- Keyboard navigation reducer ---

interface DropdownNavigationState {
  highlightedIndex: number; // -1 means nothing highlighted
  resultCount: number;
}

type DropdownAction =
  | { type: "ARROW_DOWN" }
  | { type: "ARROW_UP" }
  | { type: "RESET" }
  | { type: "SET_COUNT"; count: number }
  | { type: "SET_INDEX"; index: number };

function dropdownReducer(
  state: DropdownNavigationState,
  action: DropdownAction
): DropdownNavigationState {
  switch (action.type) {
    case "ARROW_DOWN": {
      if (state.resultCount === 0) return state;
      const next = (state.highlightedIndex + 1) % state.resultCount;
      return { ...state, highlightedIndex: next };
    }
    case "ARROW_UP": {
      if (state.resultCount === 0) return state;
      const next =
        (state.highlightedIndex - 1 + state.resultCount) % state.resultCount;
      return { ...state, highlightedIndex: next };
    }
    case "RESET":
      return { ...state, highlightedIndex: -1 };
    case "SET_COUNT":
      return { highlightedIndex: -1, resultCount: action.count };
    case "SET_INDEX":
      return { ...state, highlightedIndex: action.index };
    default:
      return state;
  }
}

// --- Props ---

interface SearchBarProps {
  onSearch: (query: string, filters: SearchFilters) => void;
  results: PlaceDetail[];
  onSelectResult: (place: PlaceDetail) => void;
  /** Whether the parent is currently loading search results */
  isSearchLoading?: boolean;
  /** Called when the dropdown should close without selecting anything (click outside, Escape)
   *  — `results` is owned by the parent, so SearchBar has no other way to hide it. */
  onDismissResults?: () => void;
}

export function SearchBar({
  onSearch,
  onDismissResults,
  results,
  onSelectResult,
  isSearchLoading = false,
}: SearchBarProps) {
  // Query and filter state
  const [query, setQuery] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [exactMatch, setExactMatch] = useState(false);
  const [indigenousOnly, setIndigenousOnly] = useState(false);
  const [crossBorder, setCrossBorder] = useState(false);
  const [selectedStates, setSelectedStates] = useState<string[]>(
    appConfig.states.map((s) => s.value)
  );

  // Plain strings, not PlaceDetail.
  const [nameSuggestions, setNameSuggestions] = useState<string[]>([]);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  const [showingSuggestions, setShowingSuggestions] = useState(false);

  const [error, setError] = useState<string | null>(null);
  // "No places found" persistent message after full search with empty results
  const [noResultsMessage, setNoResultsMessage] = useState<string | null>(null);

  const searchRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Guards against an out-of-order response overwriting a newer one — every keystroke fires its own un-debounced request.
  const suggestionRequestIdRef = useRef(0);
  // Lets the next keystroke cancel the in-flight fetch immediately, freeing the browser's
  // limited per-host connection pool for the request that will actually be used.
  const suggestionAbortRef = useRef<AbortController | null>(null);

  const [navState, dispatchNav] = useReducer(dropdownReducer, {
    highlightedIndex: -1,
    resultCount: 0,
  });

  // Which list is "active" — suggestions while typing, real results once submitted.
  const activeListLength = showingSuggestions ? nameSuggestions.length : results.length;

  useEffect(() => {
    if (results.length > 0) {
      setNoResultsMessage(null);
    }
  }, [results]);

  const isDropdownVisible = showingSuggestions
    ? nameSuggestions.length > 0 || isSuggesting || suggestionError !== null
    : results.length > 0 || isSearchLoading || error !== null || noResultsMessage !== null;

  const prevIsSearchLoadingRef = useRef(isSearchLoading);
  useEffect(() => {
    if (prevIsSearchLoadingRef.current && !isSearchLoading && results.length === 0 && query.trim()) {
      setNoResultsMessage(`No places found for "${query.trim()}"`);
    }
    prevIsSearchLoadingRef.current = isSearchLoading;
  }, [isSearchLoading, results.length, query]);

  useEffect(() => {
    dispatchNav({ type: "SET_COUNT", count: activeListLength });
  }, [activeListLength]);

  // Both halves: local suggestion state AND the parent-owned real results (via onDismissResults).
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setNameSuggestions([]);
        setShowingSuggestions(false);
        setSuggestionError(null);
        onDismissResults?.();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onDismissResults]);

  useEffect(() => {
    return () => setMapClicksDisabled(false);
  }, []);

  useEffect(() => {
    if (navState.highlightedIndex >= 0) {
      const el = document.getElementById(
        `autocomplete-option-${navState.highlightedIndex}`
      );
      if (el) {
        el.scrollIntoView({ block: "nearest" });
      }
    }
  }, [navState.highlightedIndex]);

  // --- Handlers ---

  const handleSubmit = useCallback(() => {
    setShowingSuggestions(false);
    setNameSuggestions([]);
    setSuggestionError(null);
    setShowFilters(false);
    setNoResultsMessage(null);
    // Invalidates and aborts any suggestion fetch still in flight, so its response can't
    // land after submit and repopulate nameSuggestions behind the now-real results.
    suggestionRequestIdRef.current++;
    suggestionAbortRef.current?.abort();
    onSearch(query, {
      exactMatch,
      indigenousOnly,
      crossBorder,
      states: selectedStates,
    });
  }, [query, exactMatch, indigenousOnly, crossBorder, selectedStates, onSearch]);

  const handleSelectSuggestion = useCallback((name: string) => {
    // Picking a suggestion only completes the typed text — still needs Enter/Search.
    setQuery(name);
    setShowingSuggestions(false);
    setNameSuggestions([]);
    dispatchNav({ type: "RESET" });
    inputRef.current?.focus();
  }, []);

  const handleSelectResult = useCallback(
    (place: PlaceDetail) => {
      onSelectResult(place);
      setError(null);
      setNoResultsMessage(null);
      dispatchNav({ type: "RESET" });
      inputRef.current?.focus();
    },
    [onSelectResult]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isDropdownVisible) {
        if (e.key === "Enter") handleSubmit();
        return;
      }

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          dispatchNav({ type: "ARROW_DOWN" });
          break;
        case "ArrowUp":
          e.preventDefault();
          dispatchNav({ type: "ARROW_UP" });
          break;
        case "Enter":
          e.preventDefault();
          if (
            navState.highlightedIndex >= 0 &&
            navState.highlightedIndex < activeListLength
          ) {
            if (showingSuggestions) {
              handleSelectSuggestion(nameSuggestions[navState.highlightedIndex]);
            } else {
              handleSelectResult(results[navState.highlightedIndex]);
            }
          } else {
            handleSubmit();
          }
          break;
        case "Escape":
          e.preventDefault();
          setNameSuggestions([]);
          setShowingSuggestions(false);
          setSuggestionError(null);
          onDismissResults?.();
          dispatchNav({ type: "RESET" });
          inputRef.current?.focus();
          break;
      }
    },
    [
      isDropdownVisible,
      navState.highlightedIndex,
      activeListLength,
      showingSuggestions,
      nameSuggestions,
      results,
      handleSelectSuggestion,
      handleSelectResult,
      handleSubmit,
      onDismissResults,
    ]
  );

  // Fires on every keystroke, no debounce — wired to onChange directly (not a useEffect on `query`) so a programmatic change (picking a suggestion) doesn't also re-trigger a fetch.
  const handleQueryChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);
    setShowingSuggestions(true);
    setNoResultsMessage(null);

    suggestionAbortRef.current?.abort();

    const trimmed = value.trim();
    if (trimmed.length < 1) {
      setNameSuggestions([]);
      setIsSuggesting(false);
      setSuggestionError(null);
      suggestionRequestIdRef.current++;
      return;
    }

    setIsSuggesting(true);
    setSuggestionError(null);
    const requestId = ++suggestionRequestIdRef.current;
    const controller = new AbortController();
    suggestionAbortRef.current = controller;
    fetchNameSuggestions(trimmed, controller.signal)
      .then((names) => {
        if (suggestionRequestIdRef.current !== requestId) return; // superseded by a later keystroke
        setNameSuggestions(names);
        setIsSuggesting(false);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return; // cancelled, not a real failure
        if (suggestionRequestIdRef.current !== requestId) return;
        setSuggestionError("Suggestions unavailable");
        setIsSuggesting(false);
      });
  }, []);

  const handleClear = useCallback(() => {
    setQuery("");
    setNameSuggestions([]);
    setShowingSuggestions(false);
    setSuggestionError(null);
    setError(null);
    setNoResultsMessage(null);
    suggestionRequestIdRef.current++;
    suggestionAbortRef.current?.abort();
    dispatchNav({ type: "RESET" });
    inputRef.current?.focus();
  }, []);

  const handleMouseEnterItem = useCallback((index: number) => {
    dispatchNav({ type: "SET_INDEX", index });
  }, []);

  // State toggle
  const handleStateToggle = useCallback((stateValue: string) => {
    setSelectedStates((prev) =>
      prev.includes(stateValue)
        ? prev.filter((s) => s !== stateValue)
        : [...prev, stateValue]
    );
  }, []);

  const handleAllStatesToggle = useCallback(() => {
    setSelectedStates((prev) =>
      prev.length === appConfig.states.length
        ? []
        : appConfig.states.map((s) => s.value)
    );
  }, []);

  const handleResetFilters = useCallback(() => {
    setExactMatch(false);
    setIndigenousOnly(false);
    setCrossBorder(false);
    setSelectedStates(appConfig.states.map((s) => s.value));
  }, []);

  // Filter badge count
  const activeFilterCount =
    [exactMatch, indigenousOnly, crossBorder].filter(Boolean).length +
    (selectedStates.length < appConfig.states.length ? 1 : 0);

  // Compute responsive class and inline style for SearchBar positioning
  const rootClassName = "absolute top-3 left-3 z-50 w-[360px] max-w-[calc(100%-24px)]";

  const rootStyle: React.CSSProperties | undefined = undefined;

  return (
    <div
      ref={searchRef}
      className={rootClassName}
      style={rootStyle}
      onMouseDown={(e) => e.stopPropagation()}
      aria-expanded={isDropdownVisible}
    >
      {/* Main search bar */}
      <div className="relative z-50 bg-white rounded-xl shadow-lg border border-gray-200/50">
        <div className="flex items-center px-3 py-2.5 gap-2 overflow-hidden rounded-xl">
          {/* Search icon */}
          <svg
            className="w-4 h-4 text-gray-400 shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>

          {/* Input */}
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={handleQueryChange}
            onKeyDown={handleKeyDown}
            placeholder="Search Australian place names..."
            maxLength={200}
            autoComplete="off"
            className="flex-1 text-sm text-gray-800 placeholder-gray-400 outline-hidden bg-transparent focus:outline-hidden"
            aria-activedescendant={
              navState.highlightedIndex >= 0
                ? `autocomplete-option-${navState.highlightedIndex}`
                : undefined
            }
            aria-autocomplete="list"
            aria-controls="autocomplete-listbox"
          />

          {/* Clear button */}
          {query && (
            <button
              onClick={handleClear}
              className="text-gray-400 hover:text-gray-600 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
              aria-label="Clear search"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          )}

          {/* Filter toggle button */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`relative p-1.5 rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${
              showFilters
                ? "bg-blue-100 text-blue-600"
                : "text-gray-400 hover:text-gray-600 hover:bg-gray-100"
            }`}
            aria-label="Toggle filters"
            aria-pressed={showFilters}
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
              />
            </svg>
            {/* Badge showing active filter count */}
            {activeFilterCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-blue-500 text-white text-[9px] rounded-full flex items-center justify-center font-bold">
                {activeFilterCount}
              </span>
            )}
          </button>

          {/* Search button */}
          <button
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={(e) => {
              e.stopPropagation();
              handleSubmit();
            }}
            disabled={false}
            className="px-4 py-1.5 text-xs font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 shadow-sm"
          >
            {isSearchLoading ? (
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ...
              </span>
            ) : "Search"}
          </button>
        </div>

        {/* Expandable filters panel */}
        {showFilters && (
          <FilterPanel
            exactMatch={exactMatch}
            indigenousOnly={indigenousOnly}
            crossBorder={crossBorder}
            selectedStates={selectedStates}
            onExactMatchChange={setExactMatch}
            onIndigenousChange={setIndigenousOnly}
            onCrossBorderChange={setCrossBorder}
            onStateToggle={handleStateToggle}
            onAllStatesToggle={handleAllStatesToggle}
            onReset={handleResetFilters}
            hasActiveFilters={activeFilterCount > 0}
          />
        )}

        {/* Dropdown — name suggestions while typing, real results once submitted */}
        {isDropdownVisible && (
          <div className="border-t border-gray-100" id="autocomplete-listbox">
            {showingSuggestions ? (
              suggestionError ? (
                <div className="px-4 py-4 text-center text-sm text-red-500 bg-white">{suggestionError}</div>
              ) : nameSuggestions.length === 0 ? (
                <div className="px-4 py-4 text-center text-sm text-gray-400 bg-white">
                  {isSuggesting ? "Searching…" : "No suggestions"}
                </div>
              ) : (
                <ul role="listbox" className="max-h-72 overflow-y-auto py-1 bg-white">
                  {nameSuggestions.map((name, i) => (
                    <li key={`${name}-${i}`}>
                      <button
                        type="button"
                        id={`autocomplete-option-${i}`}
                        role="option"
                        aria-selected={navState.highlightedIndex === i}
                        onMouseEnter={() => handleMouseEnterItem(i)}
                        onClick={() => handleSelectSuggestion(name)}
                        className={`w-full text-left px-4 py-2 text-sm truncate transition-colors ${
                          navState.highlightedIndex === i
                            ? "bg-blue-50 text-blue-700"
                            : "text-gray-700 hover:bg-gray-50"
                        }`}
                      >
                        {name}
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : noResultsMessage ? (
              <div className="px-4 py-4 text-center text-sm text-gray-500 bg-white">
                <span className="text-gray-400">🔍</span> {noResultsMessage}
              </div>
            ) : (
              <AutocompleteDropdown
                results={results}
                isLoading={isSearchLoading}
                error={error}
                highlightedIndex={navState.highlightedIndex}
                onSelect={handleSelectResult}
                onMouseEnterItem={handleMouseEnterItem}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
