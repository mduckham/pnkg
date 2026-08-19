/** Everything specific to skos:exactMatch cross-border ("double-circle") nodes — detection and styling only; click/expand behaviour is fully generic (GraphPanel.tsx's dbltap handler, useGraphExpansion.ts), shared with every other node type. */

import type { Core } from "cytoscape";

/** The predicate whose edges mark a node as an exact-match target. */
export const EXACT_MATCH_EDGE_LABEL = "skos:exactMatch";

/** CSS class applied to exact-match target nodes — double-circle border. */
export const EXACT_MATCH_CLASS = "exact-match";

/** Marks every skos:exactMatch edge's target with the double-circle class — must re-run after any graph mutation, or a chain (A→B→C) only gets the style on the first hop. */
export function markExactMatchNodes(cy: Core): number {
  let count = 0;
  cy.edges().forEach((edge) => {
    if (edge.data("label") === EXACT_MATCH_EDGE_LABEL) {
      const targetNode = edge.target();
      if (targetNode.length > 0 && !targetNode.hasClass(EXACT_MATCH_CLASS)) {
        targetNode.addClass(EXACT_MATCH_CLASS);
        count++;
      }
    }
  });
  return count;
}

/** Double-circle border style, spread into getCytoscapeStyles() — deliberately no border-color, so the node's own type-based colour shows through instead of a fixed colour reading wrong on a non-place node. */
export const EXACT_MATCH_NODE_STYLE = {
  selector: `node.${EXACT_MATCH_CLASS}`,
  style: { "border-style": "double", "border-width": 7 },
} as const;
