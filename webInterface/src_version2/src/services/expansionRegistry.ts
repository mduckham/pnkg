/** A pluggable handler pattern mapping node types to expansion query functions — new
 *  relationship types register a handler, no core rendering logic changes needed. */

/** Context passed to every expansion handler */
export interface ExpansionContext {
  nodeId: string;
  placeUri?: string;
  geometryUri?: string;
  placeNameUri?: string;
  /** The full URI of the node being expanded (for dynamic nodes) */
  nodeUri?: string;
  /** Set of URIs already visible in the graph — used by generic handler for dedup */
  _existingNodeUris?: Set<string>;
  /** Cap on "other" (non-exactMatch) graph-visible relationships to fetch — see genericExpansion.ts's expandNode. */
  otherRelationshipLimit?: number;
}

/** Standard result shape returned by all handlers */
export interface ExpansionResult {
  nodes: Array<{ id: string; label: string; type: string; uri?: string }>;
  edges: Array<{ source: string; target: string; label: string }>;
  /** Total count if results were truncated by per-expansion limit */
  totalCount?: number;
  /** True when "other" (non-exactMatch) relationships were sampled rather than shown in full — see GRAPH_CONFIG.EXPANSION_SAMPLE_THRESHOLD. */
  otherTruncated?: boolean;
}

/** An expansion handler function signature */
export type ExpansionHandler = (ctx: ExpansionContext) => Promise<ExpansionResult>;

/** Registry API */
export interface IExpansionRegistry {
  register(nodeType: string, handler: ExpansionHandler): void;
  canExpand(nodeType: string): boolean;
  expand(nodeType: string, ctx: ExpansionContext): Promise<ExpansionResult>;
  getRegisteredTypes(): string[];
}

/** Stores handlers keyed by node type and dispatches expansion requests to them; throws if none is registered. */
export function createExpansionRegistry(): IExpansionRegistry {
  const handlers = new Map<string, ExpansionHandler>();

  return {
    register(nodeType: string, handler: ExpansionHandler): void {
      handlers.set(nodeType, handler);
    },

    canExpand(nodeType: string): boolean {
      return handlers.has(nodeType);
    },

    async expand(nodeType: string, ctx: ExpansionContext): Promise<ExpansionResult> {
      const handler = handlers.get(nodeType);
      if (!handler) {
        throw new Error(
          `No expansion handler registered for node type: "${nodeType}"`
        );
      }
      return handler(ctx);
    },

    getRegisteredTypes(): string[] {
      return Array.from(handlers.keys());
    },
  };
}
