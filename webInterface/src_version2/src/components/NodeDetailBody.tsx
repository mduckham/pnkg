/** Shared "Type: X · Ontology / rdf:type / property list" renderer for every accordion section in DataPanel — purely presentational, the caller owns fetching. */

import { useEffect, useState } from "react";
import { appConfig } from "../config/appConfig";
import { extractLocalName, extractDistinguishingLocalName, humanizeLocalName, isInternalPnkgUri, isOwnVocabularyTermUri } from "../services/labelExtractor";
import { deriveOntologyLabel, formatDateValue, formatPanelValue, LABEL_LIKE_KEYS } from "../utils/nodeDetailsFormatting";
import type { PanelProperty } from "../types/graph";

/** dqv:isMeasurementOf has a source-data bug — every PositionalAccuracy measurement incorrectly points at the shared AttributeAccuracyMetric resource, so the headline uses the measurement's own (reliably per-dimension) URI instead; isMeasurementOf still shows under "more". */
const QUALITY_MEASUREMENT_TYPE = 'http://www.w3.org/ns/dqv#QualityMeasurement';

/** Excluded from the flat property list — already shown via the dedicated "Type:" header. */
const RDF_TYPE_PREDICATE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';

/** Abstract RDF/OWL/GeoSPARQL supertypes that carry no real information — filtered out of every TypeSummary render as noise. */
const GENERIC_SUPERTYPE_URIS = new Set([
  'http://www.w3.org/2000/01/rdf-schema#Resource',
  'http://www.opengis.net/ont/geosparql#SpatialObject',
  'http://www.opengis.net/ont/geosparql#Feature',
  'http://www.opengis.net/ont/geosparql#Geometry',
]);

/** Renders a node's rdf:type as "Type: {ClassName} · {Ontology}" with a "+N more" reveal, or a config-driven fallback when no rdf:type triple was found; exported separately so PlaceView can reuse just this piece. */
export function TypeSummary({ rdfTypes: rawRdfTypes, nodeType }: { rdfTypes: string[]; nodeType: string }) {
  const rdfTypes = rawRdfTypes.filter((t) => !GENERIC_SUPERTYPE_URIS.has(t));
  return (
    <>
      {/* Primary class — first rdf:type or config fallback, always visible */}
      {(() => {
        if (rdfTypes.length > 0) {
          const firstUri = rdfTypes[0];
          const localName = extractLocalName(firstUri);
          const ontologyLabel = deriveOntologyLabel(firstUri);
          return (
            <p className="text-xs text-gray-600 leading-snug">
              <span className="text-gray-400">Type: </span>
              <a href={firstUri} target="_blank" rel="noopener noreferrer"
                className="font-medium text-blue-600 hover:underline" title={firstUri}>
                {localName}
              </a>
              {ontologyLabel && (
                <><span className="text-gray-400"> · </span><span className="text-gray-500">{ontologyLabel}</span></>
              )}
            </p>
          );
        }
        const configInfo = appConfig.ontologyInfo[nodeType];
        if (!configInfo) return null;
        const classUri = configInfo.namespace + configInfo.className;
        return (
          <p className="text-xs text-gray-600 leading-snug">
            <span className="text-gray-400">Type: </span>
            <a href={classUri} target="_blank" rel="noopener noreferrer"
              className="font-medium text-blue-600 hover:underline" title={classUri}>
              {configInfo.className}
            </a>
            <span className="text-gray-400"> · </span>
            <span className="text-gray-500">{configInfo.ontology}</span>
          </p>
        );
      })()}

      {/* Additional rdf:type rows (2nd onward) — collapsed inside details */}
      {rdfTypes.length > 1 && (
        <details className="mt-1">
          <summary className="cursor-pointer text-xs text-gray-400 hover:text-gray-600 list-none select-none">
            +{rdfTypes.length - 1} more type{rdfTypes.length > 2 ? 's' : ''}…
          </summary>
          <div className="mt-0.5 space-y-0.5 pl-1 border-l border-gray-200">
            {rdfTypes.slice(1).map((typeUri) => {
              const localName = extractLocalName(typeUri);
              const ontologyLabel = deriveOntologyLabel(typeUri);
              return (
                <p key={typeUri} className="text-xs text-gray-600 leading-snug">
                  <a href={typeUri} target="_blank" rel="noopener noreferrer"
                    className="font-medium text-blue-600 hover:underline" title={typeUri}>
                    {localName}
                  </a>
                  {ontologyLabel && (
                    <><span className="text-gray-400"> · </span><span className="text-gray-500">{ontologyLabel}</span></>
                  )}
                </p>
              );
            })}
          </div>
        </details>
      )}

      {/* Config description (fallback path only) */}
      {rdfTypes.length === 0 && (() => {
        const configInfo = appConfig.ontologyInfo[nodeType];
        return configInfo?.description
          ? <p className="text-xs text-gray-400 mt-1 leading-tight">{configInfo.description}</p>
          : null;
      })()}
    </>
  );
}

interface NodeDetailBodyProps {
  nodeType: string;
  rdfTypes: string[];
  properties: PanelProperty[];
  /** Identifies "which node this is" so more/less expand state resets when the caller swaps nodes. */
  resetKey: string;
  /** Humanized labels ("Identifier") instead of ontology notation ("dcterms:identifier") — used only by the always-visible "Place information" zone, which reads as description, not a technical list. */
  humanizeLabels?: boolean;
  /** Rings the one property row matching this predicate — set when a canvas click was on a specific literal value, not just the owning resource (AccordionSection already highlights that). */
  highlightPredicate?: string | null;
  /** Same node-type colour the canvas uses for the resource owning these properties — small dot per row. */
  dotColor?: string;
  /** Per-row hover → canvas highlight; caller resolves ids since it knows graphBuilder's id conventions (literal:status:, literal:wkt:, ...), returning null when there's no canvas counterpart. */
  hoverTarget?: (prop: PanelProperty) => string | string[] | null;
  /** Extra className for a row's value span (e.g. green for "gazetted"). */
  valueClassName?: (prop: PanelProperty) => string | undefined;
  /** Fires the ids hoverTarget resolves to on row hover/unhover. Required whenever hoverTarget is passed. */
  onHighlightNodes?: (ids: string[]) => void;
}

export function NodeDetailBody({ nodeType, rdfTypes, properties, resetKey, humanizeLabels = false, highlightPredicate = null, dotColor, hoverTarget, valueClassName, onHighlightNodes }: NodeDetailBodyProps) {
  // Shared expanded-keys set for every "more"/"less" toggle — a real button + conditional render, not <details>, since <details> keeps its summary visible so "less" never worked and text duplicated below it.
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  useEffect(() => { setExpandedKeys(new Set()); }, [resetKey]);

  const flatProperties = properties.filter((p) => p.predicate !== RDF_TYPE_PREDICATE);
  const dot = dotColor
    ? <span className="inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle shrink-0" style={{ backgroundColor: dotColor }} />
    : null;

  return (
    <>
      <TypeSummary rdfTypes={rdfTypes} nodeType={nodeType} />

      {flatProperties.length > 0 && (
        <div className="space-y-1.5 mt-1.5">
          {(() => {
            // Group by predicate, deduping by RAW value — several distinct linked resources can share the same display text (e.g. trailing state code), which display-text dedup would collapse.
            const groups = new Map<string, { predLabel: string; entries: PanelProperty[] }>();
            for (const prop of flatProperties) {
              const key = humanizeLabels ? humanizeLocalName(extractLocalName(prop.predicate)) : prop.predicateLabel;
              if (!groups.has(key)) groups.set(key, { predLabel: key, entries: [] });
              const g = groups.get(key)!;
              if (!g.entries.some((e) => e.value === prop.value)) g.entries.push(prop);
            }

            return Array.from(groups.values()).map(({ predLabel, entries }) => {
              const first = entries[0];
              const isHighlighted = highlightPredicate != null && entries.some((e) => e.predicate === highlightPredicate);
              const highlightClass = isHighlighted ? ' ring-2 ring-inset ring-amber-400 rounded bg-amber-50/60 -mx-1 px-1 py-0.5' : '';
              // Single-value rows only — hover targeting doesn't cleanly apply to a multi-value/chain group.
              const hoverIds = entries.length === 1 ? hoverTarget?.(first) : null;
              const hoverProps = hoverIds
                ? {
                    onMouseEnter: () => onHighlightNodes?.(Array.isArray(hoverIds) ? hoverIds : [hoverIds]),
                    onMouseLeave: () => onHighlightNodes?.([]),
                  }
                : {};
              const valueClass = entries.length === 1 ? valueClassName?.(first) : undefined;

              // Single long literal — truncated preview that expands in place to the full text.
              if (entries.length === 1 && first.valueType === 'literal' && first.value.length > 100) {
                const isOpen = expandedKeys.has(predLabel);
                const preview = first.value.slice(0, 80).trim();
                return (
                  <p key={predLabel} className={`text-xs leading-relaxed${highlightClass}`} {...hoverProps}>
                    {dot}<span className="text-gray-500">{predLabel}:</span>{" "}
                    <span className={valueClass ?? "text-gray-700"}>{isOpen ? first.value : `${preview}…`}</span>{" "}
                    <button
                      type="button"
                      onClick={() => setExpandedKeys((prev) => {
                        const next = new Set(prev);
                        if (next.has(predLabel)) next.delete(predLabel);
                        else next.add(predLabel);
                        return next;
                      })}
                      className="text-blue-500 text-[11px] hover:underline"
                    >
                      {isOpen ? 'less' : 'more'}
                    </button>
                  </p>
                );
              }

              // Relationship chain — a URI property resolved one hop deeper (see resolveResourceChains), showing the linked resource's own meaningful property.
              const isChainGroup = entries.some((e) => e.resolvedProperties !== undefined);
              if (isChainGroup) {
                // Chain-resolved sub-properties don't go through formatPanelValue, so dates need the same datatype-gated formatting applied here directly.
                const formatChainValue = (rp: { value: string; datatype?: string; isExternalLink?: boolean }): string =>
                  !rp.isExternalLink && rp.datatype?.includes('date') ? formatDateValue(rp.value) : rp.value;
                return (
                  <div key={predLabel} className={`text-xs leading-relaxed space-y-1.5${highlightClass}`}>
                    {entries.map((e, i) => {
                      const subProps = e.resolvedProperties ?? [];
                      const isQualityMeasurement = e.resolvedType === QUALITY_MEASUREMENT_TYPE;
                      const primary = isQualityMeasurement
                        ? undefined
                        : subProps.find((rp) => LABEL_LIKE_KEYS.has(rp.label)) ?? subProps[0];
                      const rest = isQualityMeasurement ? subProps : subProps.filter((rp) => rp !== primary);
                      const typeLocalName = e.resolvedType ? extractLocalName(e.resolvedType) : undefined;
                      const headline = isQualityMeasurement
                        ? extractDistinguishingLocalName(e.value)
                        : primary ? formatChainValue(primary) : extractLocalName(e.value);
                      return (
                        <div key={e.value} className={i > 0 ? 'pl-2' : undefined}>
                          {i === 0 && <>{dot}<span className="text-gray-500">{predLabel}:</span></>}{" "}
                          {primary?.isExternalLink
                            ? <a href={primary.value} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">{headline}</a>
                            : <span className="text-gray-700">{headline}</span>
                          }
                          {typeLocalName && <span className="text-gray-400"> ({typeLocalName})</span>}
                          {rest.length > 0 && (() => {
                            const restKey = `${predLabel}::${e.value}`;
                            const restOpen = expandedKeys.has(restKey);
                            return (
                              <>
                                {' '}
                                <button
                                  type="button"
                                  onClick={() => setExpandedKeys((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(restKey)) next.delete(restKey);
                                    else next.add(restKey);
                                    return next;
                                  })}
                                  className="text-blue-500 text-[11px] hover:underline"
                                >
                                  {restOpen ? 'less' : 'more'}
                                </button>
                                {restOpen && (
                                  <div className="pl-2 mt-1 space-y-1 border-l border-gray-200">
                                    {rest.map((rp, j) => (
                                      <p key={j} className="text-[11px] leading-relaxed">
                                        <span className="text-gray-400">{rp.label}:</span>{" "}
                                        {rp.isExternalLink
                                          ? <a href={rp.value} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">{rp.value}</a>
                                          : <span className="text-gray-600">{formatChainValue(rp)}</span>
                                        }
                                      </p>
                                    ))}
                                  </div>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      );
                    })}
                  </div>
                );
              }

              // Plain literal/URI property — same flat rendering as before.
              const values = entries.map((e) => formatPanelValue(e));
              if (values.length > 1) {
                return (
                  <p key={predLabel} className={`text-xs leading-relaxed${highlightClass}`}>
                    {dot}<span className="text-gray-500">{predLabel}:</span>{" "}
                    <span className="text-gray-700">{values.join(', ')}</span>
                  </p>
                );
              }
              const isInternalUri = first.valueType === 'uri' && (isInternalPnkgUri(first.value) || isOwnVocabularyTermUri(first.value));
              const displayVal = values[0];
              return (
                <p key={predLabel} className={`text-xs leading-relaxed${highlightClass}`} {...hoverProps}>
                  {dot}<span className="text-gray-500">{predLabel}:</span>{" "}
                  {first.isExternalLink && !isInternalUri
                    ? <a href={first.value} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">{displayVal}</a>
                    : <span className={valueClass ?? "text-gray-700"}>{displayVal}</span>
                  }
                </p>
              );
            });
          })()}
        </div>
      )}
    </>
  );
}
