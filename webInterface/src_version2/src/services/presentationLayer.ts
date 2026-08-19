/** Classifies raw SPARQL triples into graph-visible nodes and panel-only properties,
 *  ontology-agnostically, driven entirely by the configurable Presentation Rules. */

import type {
  RawTriple,
  GraphNodeResult,
  PanelProperty,
  ClassifiedExpansionResult,
} from '../types/graph';
import type { PresentationRulesConfig, PresentationRule } from '../config/presentationRules';
import { extractPredicateLabel, extractLabel, extractLocalName, inferNodeType, formatIdentifierLabel } from './labelExtractor';

/** Builds a URI node's display label, matching graphBuilder.ts's own formatting (Geometry fallback, Placename/Place identifier preference) so an expansion-revealed node reads identically to the initial render. */
function buildNodeLabel(uri: string, nodeType: string, knownLabels?: Map<string, string>, knownIdentifiers?: Map<string, string>): string {
  const identifier = knownIdentifiers?.get(uri);
  const identifierLabel = identifier ? formatIdentifierLabel(nodeType, identifier) : undefined;
  if (identifierLabel) return identifierLabel;
  const resolved = extractLabel(uri, knownLabels);
  if (nodeType === 'geometry' && resolved === extractLocalName(uri)) {
    return `Geometry:\n${extractLocalName(uri)}`;
  }
  return resolved;
}

const LOCI_IS_MEMBER_OF = 'http://linked.data.gov.au/def/loci#isMemberOf';
const DCTERMS_PUBLISHER = 'http://purl.org/dc/terms/publisher';
const DCTERMS_SPATIAL = 'http://purl.org/dc/terms/spatial';
const PN_WAS_NAMED_BY = 'http://linked.data.gov.au/def/placenames/wasNamedBy';

/** Resolves a URI object's node type + label with predicate-driven overrides (loci:isMemberOf → plain "Place Name Meta Data", since its real title varies per jurisdiction; publisher/spatial → generic role label, not the literal child's own text) so it reads identically wherever it's found. */
function resolveNodeTypeAndLabel(
  uri: string,
  predicate: string,
  rdfType: string | undefined,
  knownLabels: Map<string, string> | undefined,
  knownIdentifiers: Map<string, string> | undefined
): { nodeType: string; label: string } {
  if (predicate === LOCI_IS_MEMBER_OF) {
    return { nodeType: 'metaData', label: 'Place Name\nMeta Data' };
  }
  if (predicate === DCTERMS_PUBLISHER) {
    return { nodeType: 'metaData', label: 'Publisher' };
  }
  if (predicate === DCTERMS_SPATIAL) {
    return { nodeType: 'metaData', label: 'Location' };
  }
  const nodeType = inferNodeType(uri, rdfType);
  const label = buildNodeLabel(uri, nodeType, knownLabels, knownIdentifiers);
  return { nodeType, label };
}

/** Finds the first matching presentation rule for a triple — first match wins,
 *  falling back to defaultMode if nothing matches. */
function findRule(
  predicate: string,
  _objectValue: string,
  objectRdfType: string | undefined,
  rules: PresentationRulesConfig
): PresentationRule {
  for (const entry of rules.rules) {
    if (entry.predicate && entry.predicate === predicate) {
      if (entry.targetType) {
        if (objectRdfType === entry.targetType) {
          return entry.rule;
        }
        continue;
      }
      return entry.rule;
    }

    if (!entry.predicate && entry.targetType && objectRdfType === entry.targetType) {
      return entry.rule;
    }
  }

  return { mode: rules.defaultMode };
}

/** Classifies raw SPARQL triples into graph nodes and panel properties. */
export function classifyTriples(
  triples: RawTriple[],
  rules: PresentationRulesConfig,
  existingNodeUris?: Set<string>,
  sourceUri?: string
): ClassifiedExpansionResult {
  const graphNodes: GraphNodeResult[] = [];
  const panelProperties: PanelProperty[] = [];
  let sourceRdfType: string | undefined;

  // Dedupes graphNodes within this single classification (same URI from multiple triples).
  const seenGraphUris = new Set<string>();

  const knownLabels = new Map<string, string>();
  // Kept as a separate map from knownLabels — see buildNodeLabel's own doc comment.
  const knownIdentifiers = new Map<string, string>();
  for (const triple of triples) {
    if (triple.objectType === 'uri' && triple.objectLabel) {
      knownLabels.set(triple.object, triple.objectLabel);
    }
    if (triple.objectType === 'uri' && triple.objectIdentifier) {
      knownIdentifiers.set(triple.object, triple.objectIdentifier);
    }
  }

  const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
  const sourceRdfTypesSet: string[] = [];
  for (const triple of triples) {
    if (triple.predicate === RDF_TYPE && triple.objectType === 'uri') {
      sourceRdfTypesSet.push(triple.object);
    }
  }
  // First kept for back-compat; all collected for the panel.
  if (sourceRdfTypesSet.length > 0) {
    sourceRdfType = sourceRdfTypesSet[0];
  }

  for (const triple of triples) {
    const rule = findRule(triple.predicate, triple.object, triple.objectRdfType, rules);
    const predicateLabel = extractPredicateLabel(triple.predicate, rule.displayName);

    // Literals always go to panel properties regardless of rule
    if (triple.objectType === 'literal') {
      panelProperties.push({
        predicate: triple.predicate,
        predicateLabel,
        value: triple.object,
        valueType: 'literal',
        datatype: triple.datatype,
        lang: triple.lang,
        category: rule.category,
        isExternalLink: false,
      });
      continue;
    }

    // URI object — classify based on rule mode.
    if (rule.mode === 'primary-graph' || rule.mode === 'secondary-graph') {
      // Always added to panelProperties too, so the panel shows the complete property set.
      panelProperties.push({
        predicate: triple.predicate,
        predicateLabel,
        value: triple.object,
        valueType: 'uri',
        category: rule.category,
        isExternalLink: triple.object.startsWith('http://') || triple.object.startsWith('https://'),
      });

      // Per Nayomi/Prof's request: the naming Authority reads visually as a grey attribute
      // (styled the same as literal nodes), so — like status/publisher-name/location-name —
      // it's duplicated per owning PlaceName rather than shared by URI like a real resource.
      // Bypasses the dedup below entirely: always a fresh node keyed by the owner (sourceUri),
      // though `uri` still carries the real Authority URI so click-through/expansion still works.
      if (triple.predicate === PN_WAS_NAMED_BY && sourceUri) {
        const { nodeType, label } = resolveNodeTypeAndLabel(triple.object, triple.predicate, triple.objectRdfType, knownLabels, knownIdentifiers);
        graphNodes.push({
          id: `${sourceUri}::wasNamedBy`,
          uri: triple.object,
          label,
          type: nodeType,
          rdfType: triple.objectRdfType,
          edgeLabel: predicateLabel,
          category: rule.category,
        });
        continue;
      }

      // Already visible elsewhere — no duplicate node, but the edge is still real; useGraphExpansion's dedup redirects it to the existing node.
      if (existingNodeUris && existingNodeUris.has(triple.object)) {
        const { nodeType, label } = resolveNodeTypeAndLabel(triple.object, triple.predicate, triple.objectRdfType, knownLabels, knownIdentifiers);
        graphNodes.push({
          id: triple.object,
          uri: triple.object,
          label,
          type: nodeType,
          rdfType: triple.objectRdfType,
          edgeLabel: predicateLabel,
          category: rule.category,
        });
        continue;
      }

      // Already added within this same expansion — another graphNode entry with the
      // same URI still produces a second edge; useGraphExpansion skips the duplicate node.
      if (seenGraphUris.has(triple.object)) {
        const { nodeType, label } = resolveNodeTypeAndLabel(triple.object, triple.predicate, triple.objectRdfType, knownLabels, knownIdentifiers);
        graphNodes.push({
          id: triple.object,
          uri: triple.object,
          label,
          type: nodeType,
          rdfType: triple.objectRdfType,
          edgeLabel: predicateLabel,
          category: rule.category,
        });
        continue;
      }

      seenGraphUris.add(triple.object);
      const { nodeType, label } = resolveNodeTypeAndLabel(triple.object, triple.predicate, triple.objectRdfType, knownLabels, knownIdentifiers);

      graphNodes.push({
        id: triple.object,
        uri: triple.object,
        label,
        type: nodeType,
        rdfType: triple.objectRdfType,
        edgeLabel: predicateLabel,
        category: rule.category,
      });
    } else {
      panelProperties.push({
        predicate: triple.predicate,
        predicateLabel,
        value: triple.object,
        valueType: 'uri',
        category: rule.category,
        isExternalLink: triple.object.startsWith('http://') || triple.object.startsWith('https://'),
      });
    }
  }

  return {
    graphNodes,
    panelProperties,
    sourceRdfType,
    sourceRdfTypes: sourceRdfTypesSet.length > 0 ? sourceRdfTypesSet : undefined,
  };
}
