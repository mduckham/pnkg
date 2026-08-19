/** Owns which of DataPanel's accordion sections are open, keyed by opaque keys (a resource's own URI for nested entries) — a KG click opens the matching section plus ancestors exclusively, while manual header clicks toggle independently. */

import { useState } from "react";

export interface UseAccordionSectionsReturn {
  isOpen(key: string): boolean;
  /** True only when open via the KG-click (auto) path, ignoring manualKeys — used by MoreDetailsToggle, since a plain isOpen(key) check also fires on manual expansion and permanently stuck "More details" open (a real bug: "Less details" never worked once triggered). */
  isAutoOpen(key: string): boolean;
  /** KG-click-driven: opens exactly this set of sections (a key, or a full ancestor path so a nested resource stays reachable, not hidden behind closed parents), collapsing everything else. `null`/`[]` closes all. */
  setAuto(keys: string | string[] | null): void;
  /** Manual panel-header click: toggles independently, allowing multiple. */
  toggleManual(key: string): void;
}

export function useAccordionSections(): UseAccordionSectionsReturn {
  const [autoKeys, setAutoKeys] = useState<Set<string>>(new Set());
  const [manualKeys, setManualKeys] = useState<Set<string>>(new Set());

  const isOpen = (key: string) => autoKeys.has(key) || manualKeys.has(key);
  const isAutoOpen = (key: string) => autoKeys.has(key);

  // KG node click — exclusive: only the target section (or, for a nested
  // one, its whole ancestor path) stays open.
  const setAuto = (keys: string | string[] | null) => {
    const next = keys == null ? [] : Array.isArray(keys) ? keys : [keys];
    setAutoKeys(new Set(next));
    setManualKeys(new Set()); // collapse all manually-opened sections
  };

  // Manual header click — additive: toggle this section, leave others alone.
  const toggleManual = (key: string) => {
    const currentlyOpen = autoKeys.has(key) || manualKeys.has(key);
    setManualKeys((prev) => {
      const next = new Set(prev);
      if (currentlyOpen) next.delete(key); else next.add(key);
      return next;
    });
    // Closing a key that was open via the auto (KG-click) path only removes
    // THIS key — siblings/ancestors opened by the same auto path stay open.
    if (currentlyOpen && autoKeys.has(key)) {
      setAutoKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  return { isOpen, isAutoOpen, setAuto, toggleManual };
}
