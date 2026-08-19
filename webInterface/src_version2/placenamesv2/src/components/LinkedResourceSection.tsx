/** The Place Information panel's generic, graph-driven linked-resource tree — recursively renders whatever a resource links to (discovered from its own RDF triples, so a new backend relationship needs no frontend change), depth-bounded since this view shows everything in full, unlike the canvas's sampling. */

import { useEffect, useMemo, useState } from "react";
import { AccordionSection } from "./MultiValuedPlacePanel";
import { NodeDetailBody } from "./NodeDetailBody";
import { useNodeDetail } from "../hooks/useNodeDetail";
import type { UseGraphStateReturn } from "../hooks/useGraphState";
import { GRAPH_CONFIG } from "../config/graphConfig";
import { appConfig } from "../config/appConfig";
import { extractDistinguishingLocalName, humanizeLocalName, isInternalPnkgUri, inferNodeType } from "../services/labelExtractor";
import { titleResourceGroup } from "../utils/nodeDetailsFormatting";
import type { PanelProperty } from "../types/graph";

function dotColorFor(nodeType: string): string {
  const entry = appConfig.nodeTypes[nodeType as keyof typeof appConfig.nodeTypes];
  return entry?.color ?? appConfig.nodeTypes.literal.color;
}

// Publisher/Location's summary text IS their one literal child's value (foaf:name/skos:prefLabel) — hovering it should highlight that literal, not the Publisher/Location node; id keyed by the resource's own uri (not the text value) matching graphBuilder.ts's per-owner literal:pub:/literal:loc: id format.
const DCTERMS_PUBLISHER_PREDICATE = 'http://purl.org/dc/terms/publisher';
const DCTERMS_SPATIAL_PREDICATE = 'http://purl.org/dc/terms/spatial';

function summaryLiteralId(predicate: string | undefined, uri: string | undefined, summary: string | undefined): string | null {
  if (!summary || !uri) return null;
  if (predicate === DCTERMS_PUBLISHER_PREDICATE) return `literal:pub:${uri}`;
  if (predicate === DCTERMS_SPATIAL_PREDICATE) return `literal:loc:${uri}`;
  return null;
}

/** Splits a resource's properties into flat rows (literals/external links) vs. internal
 *  PNKG links (grouped by predicate, each becoming its own nested section below). */
export function partitionLinkedProperties(properties: PanelProperty[]) {
  const flat: PanelProperty[] = [];
  const linkedByPredicate = new Map<string, PanelProperty[]>();
  for (const p of properties) {
    if (p.valueType === "uri" && isInternalPnkgUri(p.value)) {
      const entries = linkedByPredicate.get(p.predicate) ?? [];
      if (!entries.some((e) => e.value === p.value)) entries.push(p);
      linkedByPredicate.set(p.predicate, entries);
    } else {
      flat.push(p);
    }
  }
  return { flat, linkedByPredicate };
}

/** Groups PanelProperty entries by predicate into titled, render-ready children — the
 *  one place every caller turns a property list into `{uri, predicate, title, summary}` sections. */
export function titledLinkedChildren(
  linkedByPredicate: Map<string, PanelProperty[]>
): Array<{ uri: string; predicate: string; title: string; summary?: string; resolvedType?: string }> {
  const result: Array<{ uri: string; predicate: string; title: string; summary?: string; resolvedType?: string }> = [];
  for (const [predicate, entries] of linkedByPredicate) {
    const titled = titleResourceGroup(
      predicate,
      entries.map((e) => ({ value: e.value, resolvedType: e.resolvedType, resolvedProperties: e.resolvedProperties }))
    );
    const typeByValue = new Map(entries.map((e) => [e.value, e.resolvedType]));
    for (const t of titled) {
      result.push({ uri: t.value, predicate, title: t.title, summary: t.summary, resolvedType: typeByValue.get(t.value) });
    }
  }
  return result;
}

/** Shared "discover this resource's own linked children, and record the outcome in the
 *  cycle tracker" step — one implementation reused by every entry point into the recursive tree. */
export function useLinkedChildren(
  uri: string | null,
  properties: PanelProperty[],
  rdfTypesLength: number,
  graphState: UseGraphStateReturn
) {
  const { flat, linkedByPredicate } = useMemo(() => partitionLinkedProperties(properties), [properties]);
  const children = useMemo(() => titledLinkedChildren(linkedByPredicate), [linkedByPredicate]);

  useEffect(() => {
    if (!uri || (properties.length === 0 && rdfTypesLength === 0)) return; // not fetched yet
    if (children.length > 0) {
      graphState.markExpanded(uri, children.map((c) => c.uri), []);
    } else {
      graphState.markTerminal(uri);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri, properties, rdfTypesLength]);

  // Releases this URI's cycle-tracker mark on change/unmount — otherwise reopening an ancestor would find a stale "expanded" mark and wrongly render a dead-end "(shown above)" link.
  useEffect(() => {
    if (!uri) return;
    return () => {
      graphState.markUnexplored(uri);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri]);

  return { flat, children };
}

/** Combines a resource's identity summary with a preview of its children's titles —
 *  lets a collapsed header show the shape of its KG connections one level ahead. */
export function withRelationshipPreview(
  identitySummary: string | undefined,
  children: Array<{ title: string }>
): string | undefined {
  const preview = children.length > 0 ? children.map((c) => c.title).join(', ') : undefined;
  return [identitySummary, preview].filter(Boolean).join(' · ') || undefined;
}

interface LinkedResourceSectionProps {
  uri: string;
  title: string;
  /** At-a-glance value next to the title — answers "which Publisher/Authority" without opening it. */
  summary?: string;
  /** The predicate this resource was reached through — lets a couple of known predicates
   *  (Publisher/Location) target the summary's own literal node on hover; see summaryLiteralId. */
  predicate?: string;
  /** Peeked one hop ahead by the parent — gets the dot colour right before this section is opened. */
  resolvedType?: string;
  depth: number;
  graphState: UseGraphStateReturn;
  /** Shared panel-wide open-state reader/writer — every instance calls these with its own uri. */
  isOpenFn: (uri: string) => boolean;
  toggleSection: (uri: string) => void;
  /** Registers this section's header under its uri, so a KG click can scroll it into view. */
  registerRef?: (uri: string, el: HTMLDivElement | null) => void;
  /** Hovering this section's header highlights the matching canvas node. */
  onHighlightNodes?: (ids: string[]) => void;
  /** The URI a KG click most recently resolved to — gives it a persistent highlight, not just open state. */
  selectedUri?: string | null;
  /** Set only for a literal-value click resolved to this uri — names which property row to highlight. */
  highlightPredicate?: string | null;
}

export function LinkedResourceSection(props: LinkedResourceSectionProps) {
  const { uri, title, summary, predicate, depth, graphState, onHighlightNodes, selectedUri } = props;

  // Captured once at mount — tells a second occurrence of the same URI it's a cycle, without this occurrence's own later markExpanded blocking itself.
  const [alreadyExpandedElsewhere] = useState(() => graphState.isExpanded(uri));

  if (depth >= GRAPH_CONFIG.MAX_LINKED_RESOURCE_DEPTH || alreadyExpandedElsewhere) {
    return (
      <PlainResourceLink
        uri={uri}
        title={title}
        summary={summary}
        predicate={predicate}
        cycle={alreadyExpandedElsewhere}
        onHighlightNodes={onHighlightNodes}
        isSelected={selectedUri === uri}
      />
    );
  }

  return <ExpandableLinkedResource {...props} />;
}

function ExpandableLinkedResource({
  uri, title, summary, predicate, resolvedType, depth, graphState, isOpenFn, toggleSection, registerRef, onHighlightNodes, selectedUri, highlightPredicate,
}: LinkedResourceSectionProps) {
  const isOpen = isOpenFn(uri);
  // Fetched unconditionally, not gated by isOpen — the structure (what this connects to)
  // shows in the collapsed preview; only the full property VALUES need a click to reveal.
  const { properties, rdfTypes } = useNodeDetail(uri);
  // Prefer the freshly-fetched type; fall back to the parent's eager peek for the first render.
  const nodeType = inferNodeType(uri, rdfTypes[0] ?? resolvedType);
  const { flat, children } = useLinkedChildren(uri, properties, rdfTypes.length, graphState);
  const summaryLiteral = summaryLiteralId(predicate, uri, summary);

  return (
    <AccordionSection
      label={title}
      summary={withRelationshipPreview(summary, children)}
      dotColor={dotColorFor(nodeType)}
      depth={depth}
      isOpen={isOpen}
      isSelected={selectedUri === uri}
      onToggle={() => toggleSection(uri)}
      onMouseEnter={() => onHighlightNodes?.([uri])}
      onMouseLeave={() => onHighlightNodes?.([])}
      onSummaryEnter={summaryLiteral ? () => onHighlightNodes?.([summaryLiteral]) : undefined}
      sectionRef={registerRef ? (el) => registerRef(uri, el) : undefined}
    >
      <NodeDetailBody
        nodeType={nodeType}
        rdfTypes={rdfTypes}
        properties={flat}
        resetKey={uri}
        humanizeLabels
        highlightPredicate={selectedUri === uri ? highlightPredicate : undefined}
      />
      {children.map((child) => (
        <LinkedResourceSection
          key={`${child.predicate}::${child.uri}`}
          uri={child.uri}
          title={child.title}
          summary={child.summary}
          predicate={child.predicate}
          resolvedType={child.resolvedType}
          depth={depth + 1}
          graphState={graphState}
          isOpenFn={isOpenFn}
          toggleSection={toggleSection}
          registerRef={registerRef}
          onHighlightNodes={onHighlightNodes}
          selectedUri={selectedUri}
          highlightPredicate={highlightPredicate}
        />
      ))}
    </AccordionSection>
  );
}

/** Rendered instead of a full expandable section once recursion is cut off (depth limit or
 *  cycle guard) — still a real, clickable reference, just not fetched/recursed into again. */
function PlainResourceLink({ uri, title, summary, predicate, cycle, onHighlightNodes, isSelected }: {
  uri: string;
  title: string;
  summary?: string;
  predicate?: string;
  cycle: boolean;
  onHighlightNodes?: (ids: string[]) => void;
  isSelected?: boolean;
}) {
  // Publisher/Location's displayed value IS their own literal node's text one hop further
  // out — hovering it should target that literal, not the Publisher/Location node itself.
  const literalId = summaryLiteralId(predicate, uri, summary);
  return (
    <p
      className={`text-xs leading-relaxed py-1 ${isSelected ? 'ring-2 ring-inset ring-amber-400 bg-amber-50/60 rounded -mx-1 px-1' : ''}`}
      onMouseLeave={() => onHighlightNodes?.([])}
    >
      <span className="text-gray-500" onMouseEnter={() => onHighlightNodes?.([uri])}>{title}:</span>{" "}
      <a
        href={uri}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-500 hover:underline"
        onMouseEnter={() => onHighlightNodes?.([literalId ?? uri])}
      >
        {summary ?? humanizeLocalName(extractDistinguishingLocalName(uri))}
      </a>
      {cycle && <span className="text-gray-400"> (shown above)</span>}
    </p>
  );
}
