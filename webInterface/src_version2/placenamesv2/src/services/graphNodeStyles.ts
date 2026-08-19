/** Cytoscape stylesheet + sizing/colour constants for the Knowledge Graph canvas. */

import { appConfig } from "../config/appConfig";
import { EXACT_MATCH_NODE_STYLE } from "../utils/exactMatch";

// Every "entity" type renders at the same size; every "value"/leaf type renders at the
// same, smaller size — single source of truth here, not per-type numbers.
export const ENTITY_NODE_SIZE = 100;
export const VALUE_NODE_SIZE = 85;
export const SHOW_MORE_NODE_SIZE = 67;

/** Edge label font size — shared with graphLayout.ts's hop-sizing math (estimateLabelWidth)
 *  so the measured text always matches what's actually rendered. */
export const EDGE_LABEL_FONT_SIZE = 18;

/** Base (resting) dimensions per node type, mirroring getCytoscapeStyles — literal/resource are entity-scale since their text needs the room; graphLayout.ts reads this same map for spacing. */
export const NODE_BASE_SIZE: Record<string, number> = {
  place:          ENTITY_NODE_SIZE,
  placeName:      ENTITY_NODE_SIZE,
  classification: ENTITY_NODE_SIZE,
  geometry:       ENTITY_NODE_SIZE,
  metaData:       ENTITY_NODE_SIZE,
  literal:        ENTITY_NODE_SIZE,
  resource:       ENTITY_NODE_SIZE,
  showMore:       SHOW_MORE_NODE_SIZE,
};

/** Resting size for a node — every value/leaf type (literal, resource,
 *  including Point-coordinate literals) is the same VALUE_NODE_SIZE. */
export function nodeBaseSize(nodeType: string): number {
  return NODE_BASE_SIZE[nodeType] ?? VALUE_NODE_SIZE;
}

/** Per-node-type glow colours for the hover/select system, derived from appConfig.nodeTypes so they can't drift out of sync with the fill colours. */
export const NODE_GLOW_COLORS: Record<string, string> = {
  place:          appConfig.nodeTypes.place.borderColor,
  placeName:      appConfig.nodeTypes.placeName.borderColor,
  classification: appConfig.nodeTypes.classification.borderColor,
  geometry:       appConfig.nodeTypes.geometry.borderColor,
  metaData:       appConfig.nodeTypes.metaData.borderColor,
  literal:        appConfig.nodeTypes.literal.borderColor,
  showMore:       "#5c6bc0",
  resource:       appConfig.nodeTypes.literal.borderColor,
};

/** Bolder variant of each type's colour, distinct from NODE_GLOW_COLORS since for pale types (literal grey, metaData olive) that colour matches the resting border and is easy to miss. */
export const PANEL_HIGHLIGHT_COLORS: Record<string, string> = {
  place:          "#2f6690",
  placeName:      "#2e7d32",
  classification: appConfig.nodeTypes.classification.borderColor,
  geometry:       "#d35400",
  metaData:       "#ffd600",
  literal:        "#616161",
  showMore:       "#3f51b5",
  resource:       "#616161",
};

/** Word-wraps to a fixed character budget (Cytoscape's own auto-wrap never caps line count, letting labels spill past the circle) — respects explicit "\n" breaks, then ellipsis-truncates if still over maxLines. */
function fitNodeLabel(raw: string, maxLineChars: number, maxLines: number): string {
  if (!raw) return raw;
  const outLines: string[] = [];
  for (const paragraph of raw.split("\n")) {
    let current = "";
    for (const word of paragraph.split(" ")) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length > maxLineChars) {
        if (current) outLines.push(current);
        current = word.length > maxLineChars ? word.slice(0, maxLineChars) : word;
      } else {
        current = candidate;
      }
    }
    outLines.push(current);
  }
  if (outLines.length > maxLines) {
    const shown = outLines.slice(0, maxLines);
    const last = shown[maxLines - 1];
    shown[maxLines - 1] = (last.length >= maxLineChars ? last.slice(0, maxLineChars - 1) : last) + "…";
    return shown.join("\n");
  }
  return outLines.join("\n");
}

/** True for a Point WKT literal's label — fitNodeLabel's word-based wrapping is a poor fit
 *  since it has almost no spaces to break on. */
function isPointCoordLabel(label: string): boolean {
  return /^POINT\s*\(/i.test(label || "");
}

/** Breaks text into evenly-sized (not naively fixed-size, which left an odd orphan line) chunks joined by line breaks, keeping every character — used only for Point coordinate labels. */
function chunkFullText(raw: string, maxChunkSize: number): string {
  if (raw.length <= maxChunkSize) return raw;
  const lineCount = Math.ceil(raw.length / maxChunkSize);
  const balancedSize = Math.ceil(raw.length / lineCount);
  const chunks: string[] = [];
  for (let i = 0; i < raw.length; i += balancedSize) {
    chunks.push(raw.slice(i, i + balancedSize));
  }
  return chunks.join("\n");
}

/** Formats "POINT(lng lat)" by breaking at the natural boundary between the two numbers instead of chunkFullText's blind fixed-width split, which could cut a single number in half. */
function formatPointNodeLabel(raw: string, chunkSize: number): string {
  const m = raw.match(/^POINT\s*\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)\s*$/i);
  if (!m) return chunkFullText(raw, chunkSize);
  const [, lng, lat] = m;
  const chunkIfLong = (s: string) => (s.length > chunkSize ? chunkFullText(s, chunkSize) : s);
  return ["POINT", chunkIfLong(lng), chunkIfLong(lat)].join("\n");
}

/** Matches v1's own font stack — Cytoscape doesn't inherit page CSS for canvas-rendered text. */
export const GRAPH_FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif';

export function getCytoscapeStyles(): any[] {
  const nodeBase = {
    label: (ele: any) => fitNodeLabel(ele.data("label") || "", 13, 3),
    "font-size": 14,
    "font-family": GRAPH_FONT_FAMILY,
    "font-style": "normal",
    // Matches edgeBase's own weight below, so node and edge text read as the same font treatment.
    "font-weight": 500,
    "text-valign": "center",
    "text-halign": "center",
    "text-wrap": "wrap",
    "text-max-width": "98px",
    width: 128,
    height: 128,
    shape: "ellipse",
    "border-width": 2,
    "text-margin-y": 0,
  };

  const edgeBase = {
    label: "data(label)",
    // Single line, no wrap — edges are sized (stepForChild in graphLayout.ts) to clear both endpoints.
    "font-size": EDGE_LABEL_FONT_SIZE,
    "font-family": GRAPH_FONT_FAMILY,
    // A touch bolder than plain text, not full semibold — was 600, read as too heavy.
    "font-weight": 500,
    "font-style": "normal",
    "text-rotation": "autorotate",
    "text-border-opacity": 0,
    // Small perpendicular lift so the label floats above the edge stroke, not on top of it —
    // but text-margin only reliably clears the line for near-horizontal edges; on a radial
    // layout edges point every which way, so a background is the only angle-proof fix for the
    // line visibly cutting through the label text on steep/vertical edges.
    "text-margin-y": -10,
    color: "#333333",
    "text-background-opacity": 1,
    "text-background-color": "#f9fafb",
    "text-background-padding": "2px",
    "text-background-shape": "roundrectangle",
    // Above every node (default z-index 0) so a node's fill never paints over a nearby label.
    "z-index": 10,
  };

  // Node fill/border colours come from appConfig.nodeTypes — the single source of truth.
  const nt = appConfig.nodeTypes;

  return [
    // Every entity type is the same size; every value/leaf type is the same smaller size.
    {
      selector: "node[type='place']",
      style: { ...nodeBase, "background-color": nt.place.color, "border-color": nt.place.borderColor, color: "#1a3a5c", width: ENTITY_NODE_SIZE, height: ENTITY_NODE_SIZE, "font-weight": "bold" },
    },
    {
      selector: "node[type='placeName']",
      style: { ...nodeBase, "background-color": nt.placeName.color, "border-color": nt.placeName.borderColor, color: "#1b5e20", width: ENTITY_NODE_SIZE, height: ENTITY_NODE_SIZE },
    },
    {
      selector: "node[type='classification']",
      style: { ...nodeBase, "background-color": nt.classification.color, "border-color": nt.classification.borderColor, color: "#4a148c", width: ENTITY_NODE_SIZE, height: ENTITY_NODE_SIZE },
    },
    {
      selector: "node[type='geometry']",
      style: { ...nodeBase, "background-color": nt.geometry.color, "border-color": nt.geometry.borderColor, color: "#6b3a00", width: ENTITY_NODE_SIZE, height: ENTITY_NODE_SIZE },
    },
    {
      selector: "node[type='metaData']",
      style: { ...nodeBase, "background-color": nt.metaData.color, "border-color": nt.metaData.borderColor, color: "#4e3800", width: ENTITY_NODE_SIZE, height: ENTITY_NODE_SIZE },
    },
    {
      selector: "node[type='literal']",
      style: {
        ...nodeBase,
        // Non-point literals get entity-scale circle + denser wrap budget so real name text
        // isn't cut off. Point coordinates get their own compact character-chunked treatment.
        label: (ele: any) => {
          const l = ele.data("label") || "";
          return isPointCoordLabel(l) ? formatPointNodeLabel(l, 9) : fitNodeLabel(l, 13, 4);
        },
        "background-color": nt.literal.color, "border-color": nt.literal.borderColor, color: "#424242",
        width: ENTITY_NODE_SIZE, height: ENTITY_NODE_SIZE,
        "font-size": (ele: any) => (isPointCoordLabel(ele.data("label") || "") ? 10 : 13),
        "text-max-width": (ele: any) => (isPointCoordLabel(ele.data("label") || "") ? "58px" : "98px"),
      },
    },
    {
      selector: "node[type='resource']",
      style: {
        ...nodeBase,
        // Entity-scale circle + denser line budget so a full authority name stays legible.
        label: (ele: any) => fitNodeLabel(ele.data("label") || "", 13, 4),
        "background-color": nt.literal.color, "border-color": nt.literal.borderColor, color: "#424242",
        width: ENTITY_NODE_SIZE, height: ENTITY_NODE_SIZE, "font-size": 13, "text-max-width": "98px",
      },
    },
    {
      selector: "node[type='showMore']",
      style: {
        ...nodeBase,
        label: (ele: any) => fitNodeLabel(ele.data("label") || "", 9, 2),
        "background-color": "#e8eaf6", "border-color": "#5c6bc0", "border-style": "dotted", "border-width": 2, color: "#283593",
        width: SHOW_MORE_NODE_SIZE, height: SHOW_MORE_NODE_SIZE, "font-size": 12, "text-max-width": "59px",
      },
    },
    // 'expandable-node' deliberately has no style rule — it's a pure data flag
    // (GraphPanel.tsx reads it for hover-tooltip wording only, not a border colour).
    { selector: "node.error-node", style: { "border-color": "#f44336", "border-width": 2, "border-style": "dashed" } },
    EXACT_MATCH_NODE_STYLE,
    { selector: ".value-hidden", style: { display: "none" } },

    // ── SELECTION — bold border in the node's own colour, handled via .style() on select/unselect ──
    {
      selector: "node:selected",
      style: {
        "font-weight": "bold",
        "z-index": 999,
        opacity: 1,
        "border-width": 5,
      } as any,
    },

    // ── PANEL HIGHLIGHT — from Place Information panel hover, size set via .style() ──
    {
      selector: "node.panel-highlight",
      style: { "z-index": 500, opacity: 1 } as any,
    },

    {
      selector: "edge",
      style: {
        "curve-style": "bezier",
        width: 1.8,
        "line-color": "#333333",
        "target-arrow-color": "#333333",
        "target-arrow-shape": "triangle",
        "arrow-scale": 0.9,
        ...edgeBase,
      },
    },
    // A "second" edge into an already-existing node (useGraphExpansion.ts's `sharedTarget`) has
    // no say in that node's position — it was placed relative to whoever reached it first — so a
    // straight line here would cut through whatever sits between the two. Bows it perpendicular,
    // on whichever side points away from the graph's centre (root sits at the origin), routing it
    // through the layout's open outer space instead of its crowded interior.
    {
      selector: "edge[?sharedTarget]",
      style: {
        "curve-style": "unbundled-bezier",
        "control-point-weights": 0.5,
        "control-point-distances": (ele: any) => {
          const src = ele.source().position();
          const tgt = ele.target().position();
          const midX = (src.x + tgt.x) / 2;
          const midY = (src.y + tgt.y) / 2;
          const dx = tgt.x - src.x;
          const dy = tgt.y - src.y;
          const len = Math.hypot(dx, dy) || 1;
          // Perpendicular to the edge; sign picked so it points away from the origin at the midpoint.
          const perpX = -dy / len;
          const perpY = dx / len;
          const awayFromCentre = perpX * midX + perpY * midY >= 0 ? 1 : -1;
          return awayFromCentre * 70;
        },
      } as any,
    },
    // Line style overrides only (dashed for skos:exactMatch) — colour is uniform, set above.
    ...Object.entries(appConfig.edgeStyles).map(([predicate, style]) => ({
      selector: `edge[label='${predicate}']`,
      style: style.lineStyle ? { "line-style": style.lineStyle } : {},
    })),
  ];
}
