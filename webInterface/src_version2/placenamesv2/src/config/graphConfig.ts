/** Performance budgets, animation timings, and display thresholds for the expandable knowledge graph. */

export const GRAPH_CONFIG = {
  /** Maximum nodes allowed in the graph at once */
  NODE_BUDGET: 150,
  /** Max nodes returned by a single expansion */
  PER_EXPANSION_LIMIT: 20,
  /** Non-exact-match expansion: fewer relationships than this shows all of them, this many or more samples down to this size with a toast — skos:exactMatch is exempt, always shown in full. */
  EXPANSION_SAMPLE_THRESHOLD: 5,
  /** Threshold at which edge labels are hidden */
  EDGE_LABEL_THRESHOLD: 50,
  /** SPARQL query timeout in milliseconds */
  QUERY_TIMEOUT_MS: 15_000,
  /** Layout animation duration range */
  LAYOUT_ANIMATION_MS: { min: 300, max: 600 },
  /** Error indicator auto-dismiss time */
  ERROR_DISMISS_MS: 8_000,
  /** Collapse animation duration */
  COLLAPSE_ANIMATION_MS: 300,
  /** Fit-to-view padding in pixels */
  FIT_PADDING_PX: 30,
  /** Recursion cap for the panel's linked-resource discovery (LinkedResourceSection.tsx) — unlike the canvas, the panel shows every relationship with no sampling, so it needs its own runaway-recursion safety net; real data bottoms out well before this. */
  MAX_LINKED_RESOURCE_DEPTH: 4,
} as const;

/** User-facing feedback strings for the double-click expansion gesture — centralized so the single-call path and the recursive-walk aggregation in GraphPanel.tsx never drift out of sync. */
export const EXPANSION_MESSAGES = {
  /** Shown only when an exact-match node's own cross-border check is empty — a genuine dead end elsewhere is deliberately silent, since "no relationships found" read as misleading when data exists but isn't shown (see referencedButNotExpanded), and firing once per terminal leaf in a recursive expansion became noise. */
  NO_EXACT_MATCHES: 'No exact matches found.',
  /** Other (non-exactMatch) relationships hit EXPANSION_SAMPLE_THRESHOLD — a sample was shown instead of the full set. */
  sampled(): string {
    const n = GRAPH_CONFIG.EXPANSION_SAMPLE_THRESHOLD;
    return `More than ${n} relationships found. Showing a sample of ${n}.`;
  },
  /** The clicked node has no outgoing relationships to expand but IS referenced by others (e.g. a shared classification term) — unlike sampled(), none of those referrers are shown (would blow the node budget), so this says plainly that they exist rather than falsely claiming a sample. */
  referencedButNotExpanded(count: number, label?: string): string {
    const subject = label ? `"${label}"` : 'This';
    return `${subject} has more than ${count} relationships in the database that aren't shown here, to keep the graph a manageable size.`;
  },
} as const;
