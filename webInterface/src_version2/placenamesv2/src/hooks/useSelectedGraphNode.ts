/** Tracks whichever Knowledge Graph node was last clicked — moved out of GraphPanel.tsx (which used to own this as local state) so DataPanel, a sibling outside the graph canvas, can react to it too and resolve it to a panel section (resolvePanelSection.ts). */

import { useState } from "react";

export interface SelectedGraphNode {
  /** Cytoscape node id (synthetic or URI-based, depending on node type). */
  id: string;
  label: string;
  type: string;
  /** Real RDF URI, or null for a node with only a synthetic id (nothing to query). */
  uri: string | null;
}

export interface UseSelectedGraphNodeReturn {
  selectedNode: SelectedGraphNode | null;
  selectNode: (node: SelectedGraphNode | null) => void;
}

export function useSelectedGraphNode(): UseSelectedGraphNodeReturn {
  const [selectedNode, setSelectedNode] = useState<SelectedGraphNode | null>(null);
  return { selectedNode, selectNode: setSelectedNode };
}
