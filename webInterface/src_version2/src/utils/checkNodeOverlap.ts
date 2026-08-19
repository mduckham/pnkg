import type { Core } from "cytoscape";

/** Dev-only: console.warns if any node bounding boxes (including labels) overlap after layout. */
export function checkNodeOverlap(cy: Core): void {
  if (typeof window === 'undefined') return;
  // Only run in development (Vite sets import.meta.env.DEV)
  if (!(import.meta as any).env?.DEV) return;

  const nodes = cy.nodes();
  const overlaps: string[] = [];

  for (let i = 0; i < nodes.length; i++) {
    const bb1 = nodes[i].renderedBoundingBox({ includeLabels: true });
    for (let j = i + 1; j < nodes.length; j++) {
      const bb2 = nodes[j].renderedBoundingBox({ includeLabels: true });
      // Check if bounding boxes intersect
      const intersects =
        bb1.x1 < bb2.x2 &&
        bb1.x2 > bb2.x1 &&
        bb1.y1 < bb2.y2 &&
        bb1.y2 > bb2.y1;
      if (intersects) {
        overlaps.push(
          `"${nodes[i].data('label')}" (${nodes[i].id()}) ↔ "${nodes[j].data('label')}" (${nodes[j].id()})`
        );
      }
    }
  }

  if (overlaps.length > 0) {
    console.warn(
      `[GraphPanel] Post-layout overlap detected (${overlaps.length} pair${overlaps.length > 1 ? 's' : ''}):\n` +
      overlaps.slice(0, 10).join('\n') +
      (overlaps.length > 10 ? `\n  ... and ${overlaps.length - 10} more` : '')
    );
  }
}
