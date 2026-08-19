/** Unified place info + KG node detail panel: Identity/Place info always visible, Related Resources as accordion sections mirroring the graph; clicking a node auto-expands its section. Docked on desktop, bottom sheet on mobile. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useAccordionSections } from "../hooks/useAccordionSections";
import { resolvePanelSection, resolveLiteralOwnerUri, sectionKey, type SectionCategory } from "../utils/resolvePanelSection";
import { findResourcePathFromRoots } from "../utils/findResourcePath";
import { MultiValuedPlacePanel } from "./MultiValuedPlacePanel";
import { DataPanelSkeleton } from "./SkeletonPlaceholders";
import type { PlaceDetail, GeometryQueryResult } from "../types/place";
import type { SelectedGraphNode } from "../hooks/useSelectedGraphNode";

/** Fixed open width of the docked (desktop) panel. */
export const PANEL_WIDTH_PX = 340;

interface DataPanelProps {
  place: PlaceDetail | null;
  multiValuedData?: GeometryQueryResult | null;
  onClose: () => void;
  isLoading: boolean;
  /** Whether the panel is open — desktop slides width to PANEL_WIDTH_PX; mobile mounts/unmounts the bottom sheet. */
  isOpen: boolean;
  onHighlightNodes?: (nodeIds: string[]) => void;
  onNavigateToPlace?: (geometryUri: string) => void;
  onGeometrySwitch?: (newGeometryUri: string, wkt: string) => void;
  /** Simulates "as if this KG node was clicked" from an in-panel control. */
  onSelectNode?: (node: SelectedGraphNode) => void;
  selectedGraphNode: SelectedGraphNode | null;
  /** Triggers the canvas's own double-click expansion for a URI — used so expanding a Cross-border entry in-panel also reveals its subtree on canvas. */
  onExpandCrossBorderNode?: (uri: string) => void;
}

export function DataPanel(props: DataPanelProps) {
  const { place, isLoading, isOpen, onClose } = props;
  const isMobile = useMediaQuery("(max-width: 767px)");

  if (isMobile) {
    if (!isOpen || (!place && !isLoading)) return null;
    // `fixed`, not `absolute` — DataPanel sits inside the map pane's wrapper, which ResizableSplit
    // stacks to only the top portion on mobile, so `fixed` is needed to truly anchor to the viewport.
    return (
      <aside className="fixed bottom-0 left-0 right-0 max-h-[75vh] bg-white shadow-2xl z-30 flex flex-col rounded-t-xl">
        <PanelHeader onClose={onClose} rounded />
        <PanelBody {...props} />
      </aside>
    );
  }

  // Absolute, not a flex sibling — a flex sibling would visibly jump-resize the map on open/close, so this docks via translateX() instead while MapView.tsx reserves PANEL_WIDTH_PX of camera padding itself.
  return (
    <aside
      className="absolute top-0 right-0 h-full z-30 flex flex-col overflow-hidden bg-white border-l border-gray-200"
      style={{
        width: `${PANEL_WIDTH_PX}px`,
        transform: isOpen ? "translateX(0)" : `translateX(${PANEL_WIDTH_PX}px)`,
        transition: "transform 300ms ease",
      }}
    >
      <PanelHeader onClose={onClose} />
      <PanelBody {...props} />
    </aside>
  );
}

function PanelHeader({ onClose, rounded = false }: { onClose: () => void; rounded?: boolean }) {
  return (
    <div className={`flex items-center justify-between px-3 py-1.5 border-b border-gray-100 bg-gray-50 shrink-0 ${rounded ? "rounded-t-xl" : ""}`}>
      <span className="text-xs font-semibold text-gray-600">Place Information</span>
      <button
        onClick={onClose}
        className="w-5 h-5 flex items-center justify-center rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600"
        aria-label="Close"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

function PanelBody({
  place,
  multiValuedData,
  isLoading,
  onHighlightNodes,
  onNavigateToPlace,
  onGeometrySwitch,
  onSelectNode,
  selectedGraphNode: rawSelectedGraphNode,
  onExpandCrossBorderNode,
}: DataPanelProps) {
  // A literal canvas node has no real uri, so resolveLiteralOwnerUri translates it into its owning resource's uri first, letting downstream code treat it like a normal resource click; highlightPredicate names which row.
  const { selectedGraphNode, highlightPredicate } = useMemo(() => {
    if (rawSelectedGraphNode?.uri || !rawSelectedGraphNode?.id) {
      return { selectedGraphNode: rawSelectedGraphNode, highlightPredicate: null as string | null };
    }
    const resolved = resolveLiteralOwnerUri(rawSelectedGraphNode.id);
    if (!resolved) return { selectedGraphNode: rawSelectedGraphNode, highlightPredicate: null as string | null };
    return {
      selectedGraphNode: { ...rawSelectedGraphNode, uri: resolved.ownerUri },
      highlightPredicate: resolved.predicate,
    };
  }, [rawSelectedGraphNode]);

  // One shared accordion-state instance for the whole panel — the KG-selected node auto-expands its section; manual opens are separate/additive.
  const { isOpen, isAutoOpen, setAuto, toggleManual } = useAccordionSections();

  // Registers each section's header under its URI, so the fallback search below can scroll to it.
  const sectionRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const registerSectionRef = useCallback((uri: string, el: HTMLDivElement | null) => {
    if (el) sectionRefs.current.set(uri, el);
    else sectionRefs.current.delete(uri);
  }, []);
  const [pendingScrollUri, setPendingScrollUri] = useState<string | null>(null);
  // Set when the fallback search resolves under a non-default Name/Geometry, telling NamesSection/GeometrySection to switch their picker to that item.
  const [activeNameOverrideUri, setActiveNameOverrideUri] = useState<string | null>(null);
  const [activeGeometryOverrideUri, setActiveGeometryOverrideUri] = useState<string | null>(null);

  useEffect(() => {
    // Fallback default is the searched/clicked name, not an arbitrary SPARQL row, so a same-named sibling can't silently replace the record PlaceView actually clicked.
    const searchedNameUri = place?.placeNameUri || null;
    // Fast path: a place's own Names/Geometries/Cross-border entries — instant, no fetch.
    const fastMatch = resolvePanelSection(selectedGraphNode, multiValuedData?.places ?? []);
    if (fastMatch) {
      setAuto(fastMatch);
      setActiveNameOverrideUri(searchedNameUri);
      setActiveGeometryOverrideUri(null);
      // Place/Classification clicks resolve to the "place" category — unlike Name/Geometry,
      // that block isn't always already in view (e.g. a shared-geometry or cross-border place's
      // own Place block further down the panel), so scroll it in too. sectionKey's own format
      // is `${placeUri}::${category}`, so stripping the known suffix recovers the placeUri.
      const PLACE_SECTION_SUFFIX = "::place";
      if (fastMatch.endsWith(PLACE_SECTION_SUFFIX)) {
        setPendingScrollUri(fastMatch.slice(0, -PLACE_SECTION_SUFFIX.length));
      }
      return;
    }
    if (!selectedGraphNode?.uri) {
      setAuto(null);
      setActiveNameOverrideUri(searchedNameUri);
      setActiveGeometryOverrideUri(null);
      return;
    }
    // Fallback: not directly a Name/Geometry/Cross-border entry — may be nested deeper (Metadata, Publisher,
    // ...) under one, so search each as an independent root, leaving whatever's currently auto-open in place.
    const primaryPlace = multiValuedData?.places.find((p) => p.placeUri === place?.placeUri) ?? multiValuedData?.places[0];
    if (!primaryPlace) {
      setAuto(null);
      return;
    }
    const nameRoots = primaryPlace.names.map((n) => n.uri);
    const geometryRoots = primaryPlace.geometries.map((g) => g.uri);
    // Cross-border places are walkable roots too — expandNode fetches ANY uri's own triples, so
    // starting from a cross-border place's own uri naturally discovers its Name/Geometry/Metadata
    // (and even further cross-border hops, since skos:exactMatch is itself a walkable link),
    // reusing the exact same recursive search Name/Geometry roots already use.
    const crossBorderRoots = primaryPlace.crossBorderPlaces.map((cb) => cb.placeUri);
    if (nameRoots.length === 0 && geometryRoots.length === 0 && crossBorderRoots.length === 0) {
      setAuto(null);
      return;
    }
    let cancelled = false;
    findResourcePathFromRoots([...nameRoots, ...geometryRoots, ...crossBorderRoots], selectedGraphNode.uri).then((result) => {
      if (cancelled) return;
      if (result) {
        if (crossBorderRoots.includes(result.rootUri)) {
          // Found inside a cross-border place's own subtree, possibly several hops of chained
          // cross-border matches deep — result.path lists every place uri along that chain plus
          // the final resource's own path. CrossBorderSection's own isAutoOpenFn effect (fetch +
          // mark expanded) reacts to a place's raw uri appearing in the auto-open set, but that
          // only makes its DATA ready — the "Cross-border" ACCORDION WRAPPER around each nested
          // place's own list is a separate key (sectionKey(uri, "crossBorder")) that also has to
          // be open, or AccordionSection never renders that list at all, however ready the data
          // is. Adding it for every uri in the path is harmless for uris that aren't a place with
          // their own cross-border list — nothing ever checks that key for those.
          const crossBorderAccordionKeys = result.path.map((uri) => sectionKey(uri, "crossBorder"));
          setAuto([sectionKey(primaryPlace.placeUri, "crossBorder"), ...crossBorderAccordionKeys, ...result.path]);
          setActiveNameOverrideUri(searchedNameUri);
          setActiveGeometryOverrideUri(null);
        } else {
          const ownerCategory: SectionCategory = nameRoots.includes(result.rootUri) ? "names" : "geometry";
          setAuto([sectionKey(primaryPlace.placeUri, ownerCategory), ...result.path]);
          setActiveNameOverrideUri(ownerCategory === "names" ? result.rootUri : searchedNameUri);
          setActiveGeometryOverrideUri(ownerCategory === "geometry" ? result.rootUri : null);
        }
        setPendingScrollUri(selectedGraphNode.uri);
      }
      // else: genuinely unresolvable (e.g. nested deep in a Cross-border place's own subtree). Deliberately
      // skips setAuto(null) here — that collapses every manually-opened section, making a nested Cross-border click read as "the whole panel collapsed."
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGraphNode, multiValuedData, place]);

  // Scrolls a fallback-search match into view once its section mounts — bounded-retry, not a fixed delay, since opening the ancestor path triggers a cascade of lazy fetches.
  useEffect(() => {
    if (!pendingScrollUri) return;
    let attempts = 0;
    let timeoutId: ReturnType<typeof setTimeout>;
    const tryScroll = () => {
      const el = sectionRefs.current.get(pendingScrollUri);
      if (el) {
        el.scrollIntoView({ block: "nearest", behavior: "smooth" });
        setPendingScrollUri(null);
        return;
      }
      attempts += 1;
      if (attempts < 20) {
        timeoutId = setTimeout(tryScroll, 50);
      } else {
        setPendingScrollUri(null);
      }
    };
    timeoutId = setTimeout(tryScroll, 50);
    return () => clearTimeout(timeoutId);
  }, [pendingScrollUri]);

  // Scroll indicator — shows a subtle fade + arrow when content overflows
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollDown, setCanScrollDown] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const check = () => {
      const hasOverflow = el.scrollHeight - el.scrollTop - el.clientHeight > 20;
      setCanScrollDown(hasOverflow);
    };
    const timer = setTimeout(check, 100);
    el.addEventListener('scroll', check, { passive: true });
    const mutationObs = new MutationObserver(() => setTimeout(check, 50));
    mutationObs.observe(el, { childList: true, subtree: true, attributes: true });
    const resizeObs = new ResizeObserver(() => setTimeout(check, 50));
    resizeObs.observe(el);
    return () => {
      clearTimeout(timer);
      el.removeEventListener('scroll', check);
      mutationObs.disconnect();
      resizeObs.disconnect();
    };
  }, [multiValuedData, selectedGraphNode]);

  return (
    <div className="flex-1 min-h-0 relative">
      <div ref={scrollRef} className="overflow-y-auto h-full scroll-smooth">
        {isLoading ? (
          <DataPanelSkeleton />
        ) : multiValuedData && multiValuedData.places.length > 0 ? (
          <MultiValuedPlacePanel
            data={multiValuedData}
            primaryPlaceUri={place?.placeUri ?? null}
            onHighlightNodes={onHighlightNodes}
            onNavigateToPlace={onNavigateToPlace}
            onGeometrySwitch={onGeometrySwitch}
            onSelectNode={onSelectNode}
            selectedGraphNode={selectedGraphNode}
            isOpen={isOpen}
            isAutoOpen={isAutoOpen}
            toggleManual={toggleManual}
            registerRef={registerSectionRef}
            activeNameOverrideUri={activeNameOverrideUri}
            activeGeometryOverrideUri={activeGeometryOverrideUri}
            highlightPredicate={highlightPredicate}
            onExpandCrossBorderNode={onExpandCrossBorderNode}
          />
        ) : place ? (
          <EmptyState />
        ) : null}
      </div>
      {/* Scroll-down indicator — fixed to the bottom of the panel */}
      {canScrollDown && (
        <div
          className="absolute bottom-0 inset-x-0 pointer-events-none z-10"
          onClick={undefined}
        >
          <div className="h-8 bg-linear-to-t from-white to-transparent" />
          <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 pointer-events-auto cursor-pointer"
            onClick={() => scrollRef.current?.scrollBy({ top: 150, behavior: 'smooth' })}
          >
            <svg className="w-5 h-5 text-gray-400 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>
      )}
    </div>
  );
}


/** Shown when a geometry legitimately returns zero multi-valued SPARQL bindings. */
function EmptyState() {
  return (
    <div className="px-3 py-3 text-xs text-gray-400">
      No details found for this place.
    </div>
  );
}
