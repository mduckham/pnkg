/** Shape of nodes and edges in the knowledge graph visualization. */

/** Node types — extended with new expansion-discovered types */
export type NodeType =
  | "place"
  | "placeName"
  | "classification"
  | "geometry"
  | "metaData"
  | "literal"
  | "showMore"
  | "resource"; // Generic RDF resource (for types not in the config)

/** A node in the knowledge graph, rendered as a labeled circle. */
export interface GraphNode {
  /** Unique ID for this node */
  id: string;
  /** Display label (shown inside/below the node) — may be truncated to fit the circle */
  label: string;
  /** Untruncated version of label, for the details panel. Defaults to label when omitted. */
  fullLabel?: string;
  /** Node type — determines color */
  type: NodeType;
  /** Full URI for deduplication — used as canonical identity */
  uri?: string;
  /** X position (calculated by layout algorithm) */
  x: number;
  /** Y position */
  y: number;
  /** Radius of the circle */
  radius: number;
}

/** A labeled edge connecting two nodes. */
export interface GraphEdge {
  /** ID of the source node */
  source: string;
  /** ID of the target node */
  target: string;
  /** Relationship label (shown on the edge) */
  label: string;
}

/** The complete graph data for visualization. */
export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}


// ─── Presentation Layer Types ───────────────────────────────────────────────

/** A raw triple from SPARQL expansion query */
export interface RawTriple {
  /** Full predicate URI */
  predicate: string;
  /** Object value — URI string or literal value */
  object: string;
  /** Whether the object is a URI resource or a literal value */
  objectType: 'uri' | 'literal';
  /** XSD datatype for literals (e.g., xsd:dateTime, xsd:boolean) */
  datatype?: string;
  /** Language tag for literals (e.g., "en") */
  lang?: string;
  /** rdf:type of the object resource (if URI and known from SPARQL) */
  objectRdfType?: string;
  /** Resolved label for the object (from rdfs:label, skos:prefLabel, etc.) */
  objectLabel?: string;
  /** dcterms:identifier of the object resource, kept separate from objectLabel so an expansion-revealed PlaceName/Place matches graphBuilder.ts's "Placename: {id}" convention instead of falling back to plain name text. */
  objectIdentifier?: string;
}

/** A node to add to the graph (result of expansion classified as graph-visible) */
export interface GraphNodeResult {
  /** Unique ID for this node (typically the URI) */
  id: string;
  /** Full URI of the resource */
  uri: string;
  /** Human-readable label for display */
  label: string;
  /** Node type for styling purposes */
  type: string;
  /** rdf:type of the resource */
  rdfType?: string;
  /** Edge label connecting from the expanded node to this node */
  edgeLabel: string;
  /** Presentation category (primary, secondary) */
  category?: string;
}

/** A property to show in the Selected Node panel */
export interface PanelProperty {
  /** Full predicate URI */
  predicate: string;
  /** Human-readable label for the predicate */
  predicateLabel: string;
  /** The value to display (URI or literal text) */
  value: string;
  /** Whether the value is a URI or a literal */
  valueType: 'uri' | 'literal';
  /** XSD datatype for literals */
  datatype?: string;
  /** Language tag for literals */
  lang?: string;
  /** Presentation category for grouping (e.g., "identity", "metadata", "system") */
  category?: string;
  /** Whether this is a clickable external link (http/https URI) */
  isExternalLink: boolean;
  /** For a URI-valued property: the linked resource's own rdf:type, resolved one hop deeper so the panel can show a real chain (e.g. Publisher (foaf:Agent) → foaf:name) instead of a bare URI local name. */
  resolvedType?: string;
  /** The linked resource's own direct properties (see resolvedType). */
  resolvedProperties?: Array<{ label: string; value: string; isExternalLink?: boolean }>;
}

/** Classified expansion result — output of the Presentation Layer */
export interface ClassifiedExpansionResult {
  /** Nodes to add to the graph (primary-graph or secondary-graph) */
  graphNodes: GraphNodeResult[];
  /** Properties to show in the Selected Node panel (panel-only + literals) */
  panelProperties: PanelProperty[];
  /** rdf:type of the expanded node itself (if discovered) — first value, kept for back-compat */
  sourceRdfType?: string;
  /** ALL rdf:type values of the expanded node (from the endpoint) */
  sourceRdfTypes?: string[];
  /** Total count of graph-visible triples before truncation */
  totalGraphVisible?: number;
  /** True when non-exactMatch relationships hit EXPANSION_SAMPLE_THRESHOLD and were truncated — a boolean not a count, since the fetch only asks for n+1 rows to tell "more than n" from "n or fewer," never a real total. */
  otherTruncated?: boolean;
}
