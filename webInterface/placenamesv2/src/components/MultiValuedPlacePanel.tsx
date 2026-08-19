/** Single consistent structure for every place: Place, then Name and Geometry (core facts immediately, "More details" for what they connect to further out), then Cross-border as its own section. */

import { useEffect, useState } from 'react';
import { NodeDetailBody, TypeSummary } from './NodeDetailBody';
import { LinkedResourceSection, useLinkedChildren, partitionLinkedProperties } from './LinkedResourceSection';
import { appConfig } from '../config/appConfig';
import { useNodeDetail } from '../hooks/useNodeDetail';
import { fetchMultiValuedPlaceByPlaceUri } from '../services/placeService';
import { extractLocalName, humanizeLocalName } from '../services/labelExtractor';
import { formatPanelValue } from '../utils/nodeDetailsFormatting';
import { useGraphState, type UseGraphStateReturn } from '../hooks/useGraphState';
import { sectionKey, type SectionCategory } from '../utils/resolvePanelSection';
import type { GeometryQueryResult, MultiValuedPlace, PlaceNameRecord, GeometryRecord, CrossBorderRecord } from '../types/place';
import type { SelectedGraphNode } from '../hooks/useSelectedGraphNode';

/** Excluded from Place's flat properties — value already shown as the classification badge. */
const PLACE_CLASSIFICATION_PREDICATE = 'http://linked.data.gov.au/def/placenames/hasPlaceClassification';

/** Excluded from Name's flat properties — value already shown as the heading. */
const PLACE_NAME_LITERAL_PREDICATE = 'http://linked.data.gov.au/def/placenames/name';

/** Excluded from Geometry's flat properties — duplicates geo:asWKT's value. */
const GEO_HAS_SERIALIZATION_PREDICATE = 'http://www.opengis.net/ont/geosparql#hasSerialization';

/** Predicates with a matching literal node on the canvas, used to wire NodeDetailBody's hoverTarget. */
const PN_STATUS_PREDICATE = 'http://linked.data.gov.au/def/placenames/status';
const GEO_AS_WKT_PREDICATE = 'http://www.opengis.net/ont/geosparql#asWKT';
const DCTERMS_IDENTIFIER_PREDICATE = 'http://purl.org/dc/terms/identifier';

/** Excluded from Name's flat properties when false — a "No" row here is noise. */
const PN_IS_INDIGENOUS_PREDICATE = 'http://linked.data.gov.au/def/placenames/isIndigenous';

/** Excluded from Place's flat properties — rendered by hand on the "Place:" line instead. */
const RDF_TYPE_PREDICATE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';

interface MultiValuedPlacePanelProps {
  data: GeometryQueryResult;
  /** The place actually searched/clicked; falls back to places[0]. */
  primaryPlaceUri?: string | null;
  onHighlightNodes?: (nodeIds: string[]) => void;
  onNavigateToPlace?: (geometryUri: string) => void;
  onGeometrySwitch?: (newGeometryUri: string, wkt: string) => void;
  /** Simulates "as if this KG node was clicked" from an in-panel control. */
  onSelectNode?: (node: SelectedGraphNode) => void;
  /** Lets a section with its own picker (Geometry, Names) show the specific clicked item. */
  selectedGraphNode: SelectedGraphNode | null;
  /** Accordion open state — see useAccordionSections.ts, owned by DataPanel.tsx. */
  isOpen: (key: string) => boolean;
  /** True only when open via a Knowledge Graph click, not a manual panel click. */
  isAutoOpen: (key: string) => boolean;
  toggleManual: (key: string) => void;
  /** Registers a section's header element so a KG-driven selection can scroll it into view. */
  registerRef?: (uri: string, el: HTMLDivElement | null) => void;
  /** Set when a KG click resolved under a non-default Name/Geometry — switches the picker to it. */
  activeNameOverrideUri?: string | null;
  activeGeometryOverrideUri?: string | null;
  /** Set for a literal-value click — names which property row to highlight. */
  highlightPredicate?: string | null;
  /** Expanding a Cross-border entry in-panel also reveals that place's subtree on the canvas. */
  onExpandCrossBorderNode?: (uri: string) => void;
}

export function MultiValuedPlacePanel({ data, primaryPlaceUri, onHighlightNodes, onNavigateToPlace, onGeometrySwitch, onSelectNode, selectedGraphNode, isOpen, isAutoOpen, toggleManual, registerRef, activeNameOverrideUri, activeGeometryOverrideUri, highlightPredicate, onExpandCrossBorderNode }: MultiValuedPlacePanelProps) {
  const { places } = data;
  // Only the searched/clicked place renders in full by default — others sharing the
  // same geometry appear under "Also at this location" and expand inline on click.
  const primaryPlace = places.find((p) => p.placeUri === primaryPlaceUri) ?? places[0];
  const otherPlaces = primaryPlace.sharedGeometryPlaces;
  // Which "Also at this location" entries are expanded — data for all of them is
  // already in `places`, so expanding one is free, no new fetch.
  const [expandedOtherPlaceUris, setExpandedOtherPlaceUris] = useState<Set<string>>(new Set());
  const toggleOtherPlace = (uri: string) => {
    setExpandedOtherPlaceUris((prev) => {
      const next = new Set(prev);
      if (next.has(uri)) next.delete(uri); else next.add(uri);
      return next;
    });
  };

  return (
    <div className="px-3 py-2.5 space-y-3">
      <PlaceView
        place={primaryPlace}
        onHighlightNodes={onHighlightNodes}
        onNavigateToPlace={onNavigateToPlace}
        onGeometrySwitch={onGeometrySwitch}
        onSelectNode={onSelectNode}
        selectedGraphNode={selectedGraphNode}
        isOpen={isOpen}
        isAutoOpen={isAutoOpen}
        toggleManual={toggleManual}
        registerRef={registerRef}
        activeNameOverrideUri={activeNameOverrideUri}
        activeGeometryOverrideUri={activeGeometryOverrideUri}
        highlightPredicate={highlightPredicate}
        onExpandCrossBorderNode={onExpandCrossBorderNode}
      />

      {/* Other places sharing this geometry — clicking a name expands its own full detail inline. */}
      {otherPlaces.length > 0 && (
        <section className="border-t-2 border-gray-300 pt-2.5">
          <SectionLabel>Also at this location</SectionLabel>
          <ul className="space-y-1 mt-1.5">
            {otherPlaces.map((sp) => {
              const isExpanded = expandedOtherPlaceUris.has(sp.placeUri);
              const fullPlace = places.find((p) => p.placeUri === sp.placeUri);
              return (
                <li key={sp.placeUri}>
                  <button
                    type="button"
                    onClick={() => toggleOtherPlace(sp.placeUri)}
                    aria-expanded={isExpanded}
                    className="flex items-center gap-1 text-sm text-blue-700 hover:underline cursor-pointer"
                  >
                    <svg
                      className={`w-3 h-3 text-gray-400 shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                      fill="none" stroke="currentColor" viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: appConfig.nodeTypes.place.color }} />
                    {sp.name} <span className="text-gray-400 text-xs">({sp.classification})</span>
                  </button>
                  {isExpanded && fullPlace && (
                    // Grey card; Cross-border's own card below uses blue to stay visually distinct.
                    <div className="border border-gray-300 bg-gray-50 rounded-lg p-2.5 mt-2 mb-1">
                      <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide mb-1.5">
                        {sp.classification} · Same location
                      </p>
                      <PlaceView
                        place={fullPlace}
                        onHighlightNodes={onHighlightNodes}
                        onNavigateToPlace={onNavigateToPlace}
                        onGeometrySwitch={onGeometrySwitch}
                        onSelectNode={onSelectNode}
                        selectedGraphNode={selectedGraphNode}
                        isOpen={isOpen}
                        isAutoOpen={isAutoOpen}
                        toggleManual={toggleManual}
                        registerRef={registerRef}
                        activeNameOverrideUri={null}
                        activeGeometryOverrideUri={null}
                        highlightPredicate={highlightPredicate}
                        onExpandCrossBorderNode={onExpandCrossBorderNode}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

/* ======= Place View — the one structure used for every place ======= */

interface PlaceViewProps {
  place: MultiValuedPlace;
  onHighlightNodes?: (nodeIds: string[]) => void;
  onNavigateToPlace?: (geometryUri: string) => void;
  onGeometrySwitch?: (uri: string, wkt: string) => void;
  onSelectNode?: (node: SelectedGraphNode) => void;
  selectedGraphNode: SelectedGraphNode | null;
  isOpen: (key: string) => boolean;
  isAutoOpen: (key: string) => boolean;
  toggleManual: (key: string) => void;
  registerRef?: (uri: string, el: HTMLDivElement | null) => void;
  activeNameOverrideUri?: string | null;
  activeGeometryOverrideUri?: string | null;
  highlightPredicate?: string | null;
  onExpandCrossBorderNode?: (uri: string) => void;
  /** Place URIs already rendered further up this Cross-border chain — guards against
   *  a real KG cycle (A -> B -> A) recursing forever. Empty at the top of the chain. */
  visitedPlaceUris?: ReadonlySet<string>;
}

function PlaceView({ place, onHighlightNodes, onNavigateToPlace, onGeometrySwitch, onSelectNode, selectedGraphNode, isOpen, isAutoOpen, toggleManual, registerRef, activeNameOverrideUri, activeGeometryOverrideUri, highlightPredicate, onExpandCrossBorderNode, visitedPlaceUris }: PlaceViewProps) {
  const key = (category: SectionCategory) => sectionKey(place.placeUri, category);

  // This place, added to the path — lets CrossBorderSection recognise a cycle before fetching.
  const pathIncludingThisPlace = new Set(visitedPlaceUris);
  pathIncludingThisPlace.add(place.placeUri);

  // Place's own flat literal facts — its linked children (Name/Geometry/Cross-border)
  // are rendered explicitly below instead, not walked again generically here.
  const { properties: placeProperties, rdfTypes: placeRdfTypes } = useNodeDetail(place.placeUri);
  const { flat: placeFlatPropertiesRaw } = partitionLinkedProperties(placeProperties);
  const placeFlatProperties = placeFlatPropertiesRaw.filter((p) =>
    p.predicate !== PLACE_CLASSIFICATION_PREDICATE && p.predicate !== RDF_TYPE_PREDICATE
  );

  // Shared expansion-state tracker for every entry point into the recursive resource tree.
  const linkedResourceGraphState = useGraphState();

  // Prefer the gazetted name; a direct KG click or nested-descendant override can surface a different one.
  const defaultName = place.names.find((n) => n.status?.toLowerCase() === 'gazetted') ?? place.names[0];
  const clickedName = selectedGraphNode?.uri ? place.names.find((n) => n.uri === selectedGraphNode.uri) : undefined;
  const overrideActiveName = activeNameOverrideUri ? place.names.find((n) => n.uri === activeNameOverrideUri) : undefined;
  const activeName = clickedName ?? overrideActiveName ?? defaultName;
  const otherNames = place.names.filter((n) => n.uri !== activeName?.uri);

  return (
    <section className="space-y-3">
      <div className="space-y-3">
        <div className="space-y-1.5">
          <p
            className="flex items-center gap-2 text-xs leading-relaxed -mx-1.5 px-1.5 py-0.5 rounded cursor-pointer hover:bg-gray-50"
            onMouseEnter={() => onHighlightNodes?.([`class:${place.classification}`])}
            onMouseLeave={() => onHighlightNodes?.([])}
          >
            {/* Purple, not blue — this row's value is a Classification concept, not the Place itself. */}
            <span className="rounded-full shrink-0 w-2 h-2" style={{ backgroundColor: appConfig.nodeTypes.classification.color }} />
            <span className="font-semibold">
              <span className="text-gray-500">Place:</span>{' '}
              <span className="text-gray-700">{place.classification}</span>
            </span>
          </p>
          <div className="pl-3.5 pr-1.5">
            <TypeSummary rdfTypes={placeRdfTypes} nodeType="place" />
          </div>
          {placeFlatProperties.length > 0 && (
            <div className="pl-3.5 pr-1.5 space-y-1.5">
              {placeFlatProperties.map((prop) => (
                <p
                  key={prop.predicate}
                  className="text-xs leading-relaxed -mx-1 px-1 rounded cursor-pointer hover:bg-gray-50"
                  onMouseEnter={() => onHighlightNodes?.([place.placeUri])}
                  onMouseLeave={() => onHighlightNodes?.([])}
                >
                  {/* Blue — Place's own literal fact, unlike the purple classification row above. */}
                  <span className="inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle shrink-0" style={{ backgroundColor: appConfig.nodeTypes.place.color }} />
                  <span className="text-gray-500">{humanizeLocalName(extractLocalName(prop.predicate))}:</span>{' '}
                  <span className="text-gray-700">{formatPanelValue(prop)}</span>
                </p>
              ))}
            </div>
          )}
        </div>

        {activeName && (
          <NamesSection
            active={activeName}
            selectedGraphNode={selectedGraphNode}
            onHighlightNodes={onHighlightNodes}
            graphState={linkedResourceGraphState}
            isOpenFn={isOpen}
            isAutoOpenFn={isAutoOpen}
            toggleSection={toggleManual}
            registerRef={registerRef}
            highlightPredicate={highlightPredicate}
          />
        )}

        {place.geometries.length > 0 && (
          <GeometrySection
            geometries={place.geometries}
            selectedGraphNode={selectedGraphNode}
            activeOverrideUri={activeGeometryOverrideUri}
            onHighlightNodes={onHighlightNodes}
            onGeometrySwitch={onGeometrySwitch}
            onSelectNode={onSelectNode}
            graphState={linkedResourceGraphState}
            isOpenFn={isOpen}
            isAutoOpenFn={isAutoOpen}
            toggleSection={toggleManual}
            registerRef={registerRef}
            highlightPredicate={highlightPredicate}
          />
        )}

        {otherNames.length > 0 && (
          <OtherNamesSection
            names={otherNames}
            selectedGraphNode={selectedGraphNode}
            onHighlightNodes={onHighlightNodes}
            graphState={linkedResourceGraphState}
            isOpenFn={isOpen}
            isAutoOpenFn={isAutoOpen}
            toggleSection={toggleManual}
            registerRef={registerRef}
            highlightPredicate={highlightPredicate}
          />
        )}
      </div>

      {place.crossBorderPlaces.length > 0 && (
        <section className="border-t border-gray-200 pt-2.5">
          <CrossBorderSection
            crossBorderPlaces={place.crossBorderPlaces}
            selectedGraphNode={selectedGraphNode}
            isOpen={isOpen(key('crossBorder'))}
            onToggle={() => toggleManual(key('crossBorder'))}
            onHighlightNodes={onHighlightNodes}
            onNavigateToPlace={onNavigateToPlace}
            onGeometrySwitch={onGeometrySwitch}
            onSelectNode={onSelectNode}
            isOpenFn={isOpen}
            isAutoOpenFn={isAutoOpen}
            toggleSection={toggleManual}
            registerRef={registerRef}
            highlightPredicate={highlightPredicate}
            onExpandCrossBorderNode={onExpandCrossBorderNode}
            visitedPlaceUris={pathIncludingThisPlace}
          />
        </section>
      )}
    </section>
  );
}

/* ======= Accordion Section — shared header/body shell ======= */

interface AccordionSectionProps {
  label: string;
  dotColor?: string;
  /** Always-visible one-line value shown even while collapsed. */
  summary?: React.ReactNode;
  isOpen: boolean;
  onToggle: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  /** Overrides onMouseEnter for just the summary text — set when the summary is really a
   *  different graph node (e.g. Publisher/Location's own literal name) than this row's uri. */
  onSummaryEnter?: () => void;
  children: React.ReactNode;
  /** 0 for top-level categories; >0 for a LinkedResourceSection nested inside one, styled smaller/lighter with a guide line. */
  depth?: number;
  /** Registers this section's header under its resource URI, so a KG canvas click can scroll it into view. */
  sectionRef?: (el: HTMLDivElement | null) => void;
  /** True when this is the resource a KG canvas click most recently resolved to. */
  isSelected?: boolean;
}

export function AccordionSection({ label, dotColor, summary, isOpen, onToggle, onMouseEnter, onMouseLeave, onSummaryEnter, children, depth = 0, sectionRef, isSelected = false }: AccordionSectionProps) {
  const isSubSection = depth > 0;
  return (
    // Indent + guide line live on this outer wrapper (incl. the header button), so a
    // collapsed sub-section is still visually distinct, not just once opened.
    <div
      ref={sectionRef}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={isSubSection ? 'pl-2.5 border-l-2 border-gray-200' : undefined}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className={`flex items-center gap-2 w-full text-left group -mx-1.5 px-1.5 rounded-md transition-colors ${isSubSection ? 'py-1' : 'py-2'} ${isOpen ? 'bg-gray-50' : 'hover:bg-gray-50'} ${isSelected ? 'ring-2 ring-inset ring-amber-400 bg-amber-50/60' : ''}`}
      >
        {dotColor && (
          <span
            className={`rounded-full shrink-0 ${isSubSection ? 'w-1.5 h-1.5' : 'w-2 h-2'}`}
            style={{ backgroundColor: dotColor }}
          />
        )}
        <span
          className={
            isSubSection
              ? 'text-[10px] font-medium text-gray-500 group-hover:text-gray-700'
              : 'text-[11px] font-semibold uppercase tracking-wider text-gray-500 group-hover:text-gray-700'
          }
        >
          {label}
        </span>
        {summary && (
          <span className="text-xs text-gray-500 ml-auto mr-1 truncate" onMouseEnter={onSummaryEnter}>
            {summary}
          </span>
        )}
        <svg
          className={`text-gray-400 group-hover:text-gray-600 transition-transform shrink-0 ${isSubSection ? 'w-3 h-3' : 'w-4 h-4'} ${isOpen ? 'rotate-90' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>
      {isOpen && (
        <div className={isSubSection ? 'pl-2 pr-1.5 pb-2 space-y-1.5' : 'pl-3.5 pr-1.5 pb-2.5 space-y-2'}>
          {children}
        </div>
      )}
    </div>
  );
}

/* ======= Geometry Section ======= */

/** Defaults to the Point geometry (matching the map pin's own default), not array index 0. */
function GeometrySection({ geometries, selectedGraphNode, activeOverrideUri, onHighlightNodes, onGeometrySwitch, onSelectNode, graphState, isOpenFn, isAutoOpenFn, toggleSection, registerRef, highlightPredicate }: {
  geometries: GeometryRecord[];
  selectedGraphNode: SelectedGraphNode | null;
  /** Set when a KG click resolved under a geometry other than the one active in the picker. */
  activeOverrideUri?: string | null;
  onHighlightNodes?: (ids: string[]) => void;
  onGeometrySwitch?: (uri: string, wkt: string) => void;
  onSelectNode?: (node: SelectedGraphNode) => void;
  graphState: UseGraphStateReturn;
  isOpenFn: (uri: string) => boolean;
  /** Used only for MoreDetailsToggle's isForcedOpen. */
  isAutoOpenFn: (uri: string) => boolean;
  toggleSection: (uri: string) => void;
  registerRef?: (uri: string, el: HTMLDivElement | null) => void;
  highlightPredicate?: string | null;
}) {
  const defaultIdx = Math.max(0, geometries.findIndex((g) => g.type.toUpperCase() === 'POINT'));
  const [selectedIdx, setSelectedIdx] = useState(defaultIdx);
  // Prefer the KG-selected node if it's one of this place's own geometries, then the override, then the default.
  const clickedIdx = selectedGraphNode?.uri
    ? geometries.findIndex((g) => g.uri === selectedGraphNode.uri)
    : -1;
  const overrideIdx = activeOverrideUri
    ? geometries.findIndex((g) => g.uri === activeOverrideUri)
    : -1;
  const active = geometries[clickedIdx >= 0 ? clickedIdx : overrideIdx >= 0 ? overrideIdx : selectedIdx];

  // Fetched unconditionally so "More details" knows whether it has anything to show.
  const { properties, rdfTypes } = useNodeDetail(active?.uri ?? null);
  const { flat: flatRaw, children } = useLinkedChildren(active?.uri ?? null, properties, rdfTypes.length, graphState);
  const flat = flatRaw.filter((p) => p.predicate !== GEO_HAS_SERIALIZATION_PREDICATE);

  const handleSelect = (i: number) => {
    setSelectedIdx(i);
    const geo = geometries[i];
    if (!geo) return;
    onGeometrySwitch?.(geo.uri, geo.wkt);
    onSelectNode?.({ id: geo.uri, uri: geo.uri, label: `Geometry : ${geo.type}`, type: 'geometry' });
  };

  return (
    <PinnedResourceHeader
      label={`Geometry${geometries.length > 1 ? ` (${geometries.length})` : ''}`}
      value={active?.type}
      dotColor={appConfig.nodeTypes.geometry.color}
      bold
      isSelected={!!active && active.uri === selectedGraphNode?.uri}
      onMouseEnter={() => active && onHighlightNodes?.([active.uri])}
      onMouseLeave={() => onHighlightNodes?.([])}
    >
      {geometries.length > 1 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {geometries.map((g, i) => (
            <button
              key={g.uri}
              type="button"
              onClick={() => handleSelect(i)}
              onMouseEnter={() => onHighlightNodes?.([g.uri])}
              onMouseLeave={() => onHighlightNodes?.([])}
              className={`flex items-center gap-1.5 px-2 py-1 text-xs rounded transition-colors ${
                i === selectedIdx
                  ? 'bg-blue-100 text-blue-700 font-medium'
                  : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
              }`}
              aria-label={`Select geometry ${i + 1}: ${g.type}`}
            >
              <span className="w-1.5 h-1.5 rounded-full border shrink-0" style={{ backgroundColor: appConfig.nodeTypes.geometry.color, borderColor: appConfig.nodeTypes.geometry.borderColor }} />
              {g.type}
            </button>
          ))}
        </div>
      )}
      <NodeDetailBody
        nodeType="geometry"
        rdfTypes={rdfTypes}
        properties={flat}
        resetKey={active?.uri ?? 'none'}
        humanizeLabels
        dotColor={appConfig.nodeTypes.geometry.color}
        highlightPredicate={active?.uri === selectedGraphNode?.uri ? highlightPredicate : undefined}
        onHighlightNodes={onHighlightNodes}
        hoverTarget={(prop) => prop.predicate === GEO_AS_WKT_PREDICATE && active ? `literal:wkt:${active.uri}` : null}
      />
      {children.length > 0 && (
        <MoreDetailsToggle resetKey={active?.uri ?? 'none'} isForcedOpen={children.some((c) => isAutoOpenFn(c.uri))}>
          {children.map((child) => (
            <LinkedResourceSection
              key={`${child.predicate}::${child.uri}`}
              uri={child.uri}
              title={child.title}
              summary={child.summary}
              resolvedType={child.resolvedType}
              depth={1}
              graphState={graphState}
              isOpenFn={isOpenFn}
              toggleSection={toggleSection}
              registerRef={registerRef}
              onHighlightNodes={onHighlightNodes}
              selectedUri={selectedGraphNode?.uri ?? null}
              highlightPredicate={highlightPredicate}
            />
          ))}
        </MoreDetailsToggle>
      )}
    </PinnedResourceHeader>
  );
}

/* ======= Names Section ======= */

function NamesSection({ active, selectedGraphNode, onHighlightNodes, graphState, isOpenFn, isAutoOpenFn, toggleSection, registerRef, highlightPredicate }: {
  /** Which name is shown here — resolved once in PlaceView so OtherNamesSection can exclude it. */
  active: PlaceNameRecord;
  selectedGraphNode: SelectedGraphNode | null;
  onHighlightNodes?: (ids: string[]) => void;
  graphState: UseGraphStateReturn;
  isOpenFn: (uri: string) => boolean;
  /** Used only for MoreDetailsToggle's isForcedOpen. */
  isAutoOpenFn: (uri: string) => boolean;
  toggleSection: (uri: string) => void;
  registerRef?: (uri: string, el: HTMLDivElement | null) => void;
  highlightPredicate?: string | null;
}) {
  return (
    <PinnedResourceHeader
      label="Name"
      value={active.name}
      badge={active.isIndigenous ? (
        <span
          className="text-[10px] px-1.5 py-0.5 rounded-full inline-block align-middle"
          style={{ color: '#5d4037', backgroundColor: '#efebe9', border: '1px solid #a1887f' }}
          title="Indigenous Place Name"
        >
          Indigenous
        </span>
      ) : undefined}
      dotColor={appConfig.nodeTypes.placeName.color}
      bold
      isSelected={active.uri === selectedGraphNode?.uri}
      // Highlights the pn:name literal circle, not the PlaceName node (whose label is the identifier).
      onMouseEnter={() => onHighlightNodes?.([`${active.uri}::name`])}
      onMouseLeave={() => onHighlightNodes?.([])}
    >
      <NameOwnDetail
        name={active}
        selectedGraphNode={selectedGraphNode}
        onHighlightNodes={onHighlightNodes}
        graphState={graphState}
        isOpenFn={isOpenFn}
        isAutoOpenFn={isAutoOpenFn}
        toggleSection={toggleSection}
        registerRef={registerRef}
        highlightPredicate={highlightPredicate}
      />
    </PinnedResourceHeader>
  );
}

/* ======= Other Names Section (renders AFTER Geometry — see PlaceView) ======= */

function OtherNamesSection({ names, selectedGraphNode, onHighlightNodes, graphState, isOpenFn, isAutoOpenFn, toggleSection, registerRef, highlightPredicate }: {
  names: PlaceNameRecord[];
  selectedGraphNode: SelectedGraphNode | null;
  onHighlightNodes?: (ids: string[]) => void;
  graphState: UseGraphStateReturn;
  isOpenFn: (uri: string) => boolean;
  isAutoOpenFn: (uri: string) => boolean;
  toggleSection: (uri: string) => void;
  registerRef?: (uri: string, el: HTMLDivElement | null) => void;
  highlightPredicate?: string | null;
}) {
  const [expandedUris, setExpandedUris] = useState<Set<string>>(new Set());
  const toggleExpanded = (uri: string) => {
    setExpandedUris((prev) => {
      const next = new Set(prev);
      if (next.has(uri)) next.delete(uri); else next.add(uri);
      return next;
    });
  };

  return (
    <div>
      <p className="text-[11px] text-gray-400">Other names for this place</p>
      <ul className="space-y-1 mt-1">
        {names.map((n) => {
          const isExpanded = expandedUris.has(n.uri);
          return (
            <li key={n.uri}>
              <button
                type="button"
                onClick={() => toggleExpanded(n.uri)}
                onMouseEnter={() => onHighlightNodes?.([n.uri])}
                onMouseLeave={() => onHighlightNodes?.([])}
                aria-expanded={isExpanded}
                className="flex items-center gap-1.5 w-full text-left text-xs py-0.5"
              >
                <svg
                  className={`w-3 h-3 text-gray-400 shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: appConfig.nodeTypes.placeName.color }} />
                <span className="flex-1 truncate text-blue-700 hover:underline">{n.name}</span>
                {n.isIndigenous && (
                  <span className="text-[10px] shrink-0" style={{ color: '#5d4037' }} title="Indigenous Place Name">
                    Indigenous
                  </span>
                )}
                {n.status && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${n.status.toLowerCase() === 'gazetted' ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
                    {n.status}
                  </span>
                )}
              </button>
              {isExpanded && (
                <div className="pl-2.5 border-l-2 border-gray-200 mt-1.5 mb-1 space-y-1.5">
                  <NameOwnDetail
                    name={n}
                    selectedGraphNode={selectedGraphNode}
                    onHighlightNodes={onHighlightNodes}
                    graphState={graphState}
                    isOpenFn={isOpenFn}
                    isAutoOpenFn={isAutoOpenFn}
                    toggleSection={toggleSection}
                    registerRef={registerRef}
                    highlightPredicate={highlightPredicate}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** One PlaceName's own detail — shared by the primary Name and each entry in "Other names." */
function NameOwnDetail({ name, selectedGraphNode, onHighlightNodes, graphState, isOpenFn, isAutoOpenFn, toggleSection, registerRef, highlightPredicate }: {
  name: PlaceNameRecord;
  selectedGraphNode: SelectedGraphNode | null;
  onHighlightNodes?: (ids: string[]) => void;
  graphState: UseGraphStateReturn;
  isOpenFn: (uri: string) => boolean;
  /** Used only for MoreDetailsToggle's isForcedOpen below. */
  isAutoOpenFn: (uri: string) => boolean;
  toggleSection: (uri: string) => void;
  registerRef?: (uri: string, el: HTMLDivElement | null) => void;
  highlightPredicate?: string | null;
}) {
  const { properties, rdfTypes } = useNodeDetail(name.uri);
  const { flat: flatRaw, children } = useLinkedChildren(name.uri, properties, rdfTypes.length, graphState);
  // pn:name excluded (duplicates the heading); pn:isIndigenous excluded when false (noise).
  const flat = flatRaw.filter((p) =>
    p.predicate !== PLACE_NAME_LITERAL_PREDICATE &&
    !(p.predicate === PN_IS_INDIGENOUS_PREDICATE && p.value !== 'true')
  );

  return (
    <>
      <NodeDetailBody
        nodeType="placeName"
        rdfTypes={rdfTypes}
        properties={flat}
        resetKey={name.uri}
        humanizeLabels
        dotColor={appConfig.nodeTypes.placeName.color}
        highlightPredicate={name.uri === selectedGraphNode?.uri ? highlightPredicate : undefined}
        onHighlightNodes={onHighlightNodes}
        // Status's canvas literal id uses the extracted label (extractLocalName), not the raw URI.
        // Identifier hovers straight to the PlaceName node — its label already shows the identifier.
        hoverTarget={(prop) => {
          if (prop.predicate === PN_STATUS_PREDICATE) return `literal:status:${extractLocalName(prop.value)}`;
          if (prop.predicate === DCTERMS_IDENTIFIER_PREDICATE) return name.uri;
          return null;
        }}
      />
      {/* Location + Publisher pulled up from Metadata as a deliberate special case — everything
          else Metadata carries still surfaces generically via "More details" below. */}
      {(name.location || name.publisher) && (
        <div className="space-y-1.5">
          {name.location && (
            <p className="text-xs leading-relaxed" onMouseLeave={() => onHighlightNodes?.([])}>
              {/* Metadata's yellow, not PlaceName's green — Location is owned by Metadata, not PlaceName. */}
              <span className="inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle shrink-0" style={{ backgroundColor: appConfig.nodeTypes.metaData.color }} />
              {/* Label hovers the Location node itself; the value is a SEPARATE literal node one
                  hop further out (dcterms:spatial then skos:prefLabel) — each needs its own target. */}
              <span className="text-gray-500" onMouseEnter={() => name.locationUri && onHighlightNodes?.([name.locationUri])}>Location:</span>{' '}
              {name.locationUri ? (
                <a href={name.locationUri} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline" onMouseEnter={() => onHighlightNodes?.([`literal:loc:${name.location}`])}>{name.location}</a>
              ) : (
                <span className="text-gray-700">{name.location}</span>
              )}
            </p>
          )}
          {name.publisher && (
            <p className="text-xs leading-relaxed" onMouseLeave={() => onHighlightNodes?.([])}>
              <span className="inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle shrink-0" style={{ backgroundColor: appConfig.nodeTypes.metaData.color }} />
              {/* Same split as Location above — label targets Publisher, value targets its own
                  literal node (dcterms:publisher then foaf:name). */}
              <span className="text-gray-500" onMouseEnter={() => name.publisherUri && onHighlightNodes?.([name.publisherUri])}>Publisher:</span>{' '}
              {name.publisherUri ? (
                <a href={name.publisherUri} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline" onMouseEnter={() => onHighlightNodes?.([`literal:pub:${name.publisher}`])}>{name.publisher}</a>
              ) : (
                <span className="text-gray-700">{name.publisher}</span>
              )}
            </p>
          )}
        </div>
      )}
      {children.length > 0 && (
        <MoreDetailsToggle resetKey={name.uri} isForcedOpen={children.some((c) => isAutoOpenFn(c.uri))}>
          {children.map((child) => (
            <LinkedResourceSection
              key={`${child.predicate}::${child.uri}`}
              uri={child.uri}
              title={child.title}
              summary={child.summary}
              resolvedType={child.resolvedType}
              depth={1}
              graphState={graphState}
              isOpenFn={isOpenFn}
              toggleSection={toggleSection}
              registerRef={registerRef}
              onHighlightNodes={onHighlightNodes}
              selectedUri={selectedGraphNode?.uri ?? null}
              highlightPredicate={highlightPredicate}
            />
          ))}
        </MoreDetailsToggle>
      )}
    </>
  );
}

/* ======= Cross-border Section ======= */

/** A Cross-border entry expands in place — unlike "Also at this location," this needs a
 *  real fetch (a different state's own record). Cached in local state per placeUri. */
function CrossBorderSection({
  crossBorderPlaces, selectedGraphNode, isOpen, onToggle, onHighlightNodes, onNavigateToPlace,
  onGeometrySwitch, onSelectNode, isOpenFn, isAutoOpenFn, toggleSection, registerRef, highlightPredicate,
  onExpandCrossBorderNode, visitedPlaceUris,
}: {
  crossBorderPlaces: CrossBorderRecord[];
  selectedGraphNode?: SelectedGraphNode | null;
  isOpen: boolean;
  onToggle: () => void;
  onHighlightNodes?: (ids: string[]) => void;
  onNavigateToPlace?: (geometryUri: string) => void;
  onGeometrySwitch?: (uri: string, wkt: string) => void;
  onSelectNode?: (node: SelectedGraphNode) => void;
  isOpenFn: (key: string) => boolean;
  isAutoOpenFn: (key: string) => boolean;
  toggleSection: (key: string) => void;
  registerRef?: (uri: string, el: HTMLDivElement | null) => void;
  highlightPredicate?: string | null;
  /** Also reveals this place's full subtree on the Knowledge Graph canvas. */
  onExpandCrossBorderNode?: (uri: string) => void;
  /** Places already rendered further up this chain — a cycle entry shows an
   *  "already shown above" note instead of fetching a duplicate PlaceView. */
  visitedPlaceUris?: ReadonlySet<string>;
}) {
  const [expandedUris, setExpandedUris] = useState<Set<string>>(new Set());
  const [detailByUri, setDetailByUri] = useState<Map<string, MultiValuedPlace | 'loading' | 'error'>>(new Map());

  const toggleExpanded = (placeUri: string, isCycle: boolean) => {
    setExpandedUris((prev) => {
      const next = new Set(prev);
      if (next.has(placeUri)) {
        next.delete(placeUri);
        return next;
      }
      next.add(placeUri);
      // Cycle entries only show the "already shown above" note — no fetch, no re-expansion.
      if (isCycle) return next;
      onExpandCrossBorderNode?.(placeUri);
      if (!detailByUri.has(placeUri)) {
        setDetailByUri((prevMap) => new Map(prevMap).set(placeUri, 'loading'));
        fetchMultiValuedPlaceByPlaceUri(placeUri)
          .then((place) => setDetailByUri((prevMap) => new Map(prevMap).set(placeUri, place ?? 'error')))
          .catch(() => setDetailByUri((prevMap) => new Map(prevMap).set(placeUri, 'error')));
      }
      return next;
    });
  };

  return (
    <AccordionSection
      label="Cross-border"
      dotColor={appConfig.nodeTypes.place.color}
      summary={String(crossBorderPlaces.length)}
      isOpen={isOpen}
      onToggle={onToggle}
    >
      <ul className="space-y-1">
        {crossBorderPlaces.map((cb) => {
          const isExpanded = expandedUris.has(cb.placeUri);
          const detail = detailByUri.get(cb.placeUri);
          // A real KG cycle — still shown/clickable, but never fetches/renders a duplicate PlaceView.
          const isCycle = visitedPlaceUris?.has(cb.placeUri) ?? false;
          return (
            <li key={cb.placeUri}>
              <button
                type="button"
                onClick={() => toggleExpanded(cb.placeUri, isCycle)}
                onMouseEnter={() => onHighlightNodes?.([cb.placeUri])}
                onMouseLeave={() => onHighlightNodes?.([])}
                aria-expanded={isExpanded}
                title={isCycle ? "Already shown earlier in this chain" : undefined}
                className={`flex items-center gap-1.5 w-full text-left text-sm py-0.5 rounded ${cb.placeUri === selectedGraphNode?.uri ? 'ring-2 ring-inset ring-amber-400 bg-amber-50/60' : ''}`}
              >
                <svg
                  className={`w-3 h-3 text-gray-400 shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: appConfig.nodeTypes.place.color }} />
                <span className={`flex-1 truncate hover:underline ${isCycle ? 'text-gray-500' : 'text-blue-700'}`}>{cb.name}</span>
                <span className="text-xs text-gray-400 shrink-0">({cb.state})</span>
                {isCycle && <span className="text-gray-400 shrink-0" title="Already shown earlier in this chain">↺</span>}
              </button>
              {isExpanded && isCycle && (
                <p className="text-xs text-gray-400 italic pl-2.5 border-l-2 border-gray-200 mt-1.5 mb-1 py-1">
                  Already shown above — expansion stopped to avoid a loop.
                </p>
              )}
              {isExpanded && !isCycle && (
                <div
                  className="border rounded-lg p-2.5 mt-1.5 mb-1"
                  style={{ borderColor: appConfig.nodeTypes.place.borderColor, backgroundColor: '#eef6fb' }}
                >
                  {detail === 'loading' && <p className="text-xs text-gray-400 py-1">Loading…</p>}
                  {detail === 'error' && <p className="text-xs text-red-500 py-1">Couldn't load this place.</p>}
                  {detail && detail !== 'loading' && detail !== 'error' && (
                    <>
                      {/* Blue caption vs. "Also at this location"'s grey, so the two stay visually distinct. */}
                      <p className="text-[10px] font-medium uppercase tracking-wide mb-1.5" style={{ color: appConfig.nodeTypes.place.borderColor }}>
                        {cb.state} · Cross-border match
                      </p>
                      <PlaceView
                        place={detail}
                        onHighlightNodes={onHighlightNodes}
                        onNavigateToPlace={onNavigateToPlace}
                        onGeometrySwitch={onGeometrySwitch}
                        onSelectNode={onSelectNode}
                        selectedGraphNode={selectedGraphNode ?? null}
                        isOpen={isOpenFn}
                        isAutoOpen={isAutoOpenFn}
                        toggleManual={toggleSection}
                        registerRef={registerRef}
                        activeNameOverrideUri={null}
                        activeGeometryOverrideUri={null}
                        highlightPredicate={highlightPredicate}
                        onExpandCrossBorderNode={onExpandCrossBorderNode}
                        visitedPlaceUris={visitedPlaceUris}
                      />
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </AccordionSection>
  );
}

/* ======= Shared sub-components ======= */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h4 className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{children}</h4>;
}

/** Header for Name/Geometry — same visual language as AccordionSection's header, but
 *  not a toggle: these two are always expanded, so there's no chevron/onClick. */
function PinnedResourceHeader({ label, value, badge, dotColor, bold, isSelected, onMouseEnter, onMouseLeave, children }: {
  label: string;
  /** The resource's own headline value, rendered inline after the label. */
  value?: string;
  /** Small inline flag next to the value (e.g. the Indigenous marker). */
  badge?: React.ReactNode;
  /** Same node-type colour the canvas uses for this resource kind. */
  dotColor: string;
  /** Bolds the label + value — Name and Geometry both pass this (their own headline facts). */
  bold?: boolean;
  isSelected: boolean;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        className={`flex items-center gap-2 text-xs leading-relaxed -mx-1.5 px-1.5 py-0.5 rounded-md cursor-default ${isSelected ? 'ring-2 ring-inset ring-amber-400 bg-amber-50/60' : ''}`}
      >
        <span className="rounded-full shrink-0 w-2 h-2" style={{ backgroundColor: dotColor }} />
        <span className={bold ? 'font-semibold' : undefined}>
          <span className="text-gray-500">{label}:</span>
          {value && <> <span className="text-gray-700">{value}</span></>}
          {badge && <> {badge}</>}
        </span>
      </p>
      <div className="pl-3.5 pr-1.5 pt-1 space-y-2">
        {children}
      </div>
    </div>
  );
}

/** Toggle wrapping a resource's deeper relationships. isForcedOpen overrides local
 *  collapsed state when a KG canvas click resolved to something nested inside. */
function MoreDetailsToggle({ resetKey, isForcedOpen, children }: {
  resetKey: string;
  isForcedOpen: boolean;
  children: React.ReactNode;
}) {
  const [manualOpen, setManualOpen] = useState(false);
  useEffect(() => setManualOpen(false), [resetKey]);
  const open = manualOpen || isForcedOpen;

  return (
    <div>
      <button
        type="button"
        onClick={() => setManualOpen((v) => !v)}
        className="text-blue-500 text-[11px] hover:underline"
      >
        {open ? 'Less details…' : 'More details…'}
      </button>
      {open && <div className="mt-1.5 space-y-1.5">{children}</div>}
    </div>
  );
}
