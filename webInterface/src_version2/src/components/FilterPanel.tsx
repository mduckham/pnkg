/** Extracted from SearchBar — the expandable filter chips (Exact Match, Indigenous Names, Cross-border) and Australian state toggle buttons. */

import { appConfig } from "../config/appConfig";

interface FilterPanelProps {
  exactMatch: boolean;
  indigenousOnly: boolean;
  crossBorder: boolean;
  selectedStates: string[];
  onExactMatchChange: (val: boolean) => void;
  onIndigenousChange: (val: boolean) => void;
  onCrossBorderChange: (val: boolean) => void;
  onStateToggle: (stateValue: string) => void;
  onAllStatesToggle: () => void;
  onReset: () => void;
  /** Whether any filter differs from default — reset only renders when there's actually something to reset. */
  hasActiveFilters: boolean;
}

export function FilterPanel({
  exactMatch,
  indigenousOnly,
  crossBorder,
  selectedStates,
  onExactMatchChange,
  onIndigenousChange,
  onCrossBorderChange,
  onStateToggle,
  onAllStatesToggle,
  onReset,
  hasActiveFilters,
}: FilterPanelProps) {
  const allSelected = selectedStates.length === appConfig.states.length;

  return (
    <div className="px-3 pb-2 pt-1 border-t border-gray-100">
      {/* Header row — label + reset action, only shown once something's
          actually been changed from the defaults. */}
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">
          Filters
        </span>
        {hasActiveFilters && (
          <button
            type="button"
            onClick={onReset}
            className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-blue-600 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 rounded"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Reset
          </button>
        )}
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-2 mb-1.5">
        <FilterChip
          label="Exact match"
          tooltip="Only show places that match the name exactly"
          checked={exactMatch}
          onChange={onExactMatchChange}
        />
        <FilterChip
          label="Indigenous names"
          tooltip="Only show Aboriginal and Torres Strait Islander place names"
          checked={indigenousOnly}
          onChange={onIndigenousChange}
        />
        <FilterChip
          label="Cross-border"
          tooltip="Only show places that exist across state boundaries"
          checked={crossBorder}
          onChange={onCrossBorderChange}
        />
      </div>

      {/* State filter toggle buttons */}
      <div className="flex flex-wrap gap-1 mt-1.5">
        <button
          onClick={onAllStatesToggle}
          aria-pressed={allSelected}
          className={`px-2 py-0.5 text-[11px] rounded-full border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${
            allSelected
              ? "bg-blue-500 text-white border-blue-500"
              : "bg-white text-gray-600 border-gray-300 hover:border-blue-400"
          }`}
        >
          All
        </button>
        {appConfig.states.map((state) => (
          <button
            key={state.value}
            onClick={() => onStateToggle(state.value)}
            aria-pressed={selectedStates.includes(state.value)}
            className={`px-2 py-0.5 text-[11px] rounded-full border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${
              selectedStates.includes(state.value)
                ? "bg-blue-500 text-white border-blue-500"
                : "bg-white text-gray-600 border-gray-300 hover:border-blue-400"
            }`}
          >
            {state.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A pill-shaped on/off toggle chip for filter options — a <button> for native Enter/Space activation, not a checkbox. */
function FilterChip({
  label,
  tooltip,
  checked,
  onChange,
}: {
  label: string;
  tooltip?: string;
  checked: boolean;
  onChange: (val: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      title={tooltip}
      className={`px-2.5 py-1 text-xs rounded-full border transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${
        checked
          ? "bg-blue-50 text-blue-700 border-blue-200 shadow-sm"
          : "bg-white text-gray-500 border-gray-200 hover:border-gray-300"
      }`}
    >
      {checked && (
        <svg
          className="w-3 h-3 inline mr-1 -mt-0.5"
          fill="currentColor"
          viewBox="0 0 20 20"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
            clipRule="evenodd"
          />
        </svg>
      )}
      {label}
    </button>
  );
}
