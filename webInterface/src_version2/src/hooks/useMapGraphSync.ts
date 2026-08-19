/** Syncs the map and knowledge graph, with a lock/freeze mechanism for the graph side only — unlocked, the graph follows map selections; locked, it freezes on a snapshot. The map itself has no lock; it always follows selection/geometry clicks (see fitAllGeometries in App.tsx), with a "reset view" control instead of a separate map lock toggle. */

import { useState, useCallback, useMemo } from "react";
import type { PlaceDetail, GeometryQueryResult } from "../types/place";
import type { GraphData } from "../types/graph";
import { buildGraphFromPlace, buildGraphFromMultiValuedData } from "../services/graphBuilder";

interface SyncState {
  /** Whether the graph panel is frozen */
  graphLocked: boolean;
  /** Snapshot of the place when graph was locked */
  frozenPlace: PlaceDetail | null;
  /** Graph data snapshot preserved while locked */
  frozenGraphData: GraphData | null;
}

export function useMapGraphSync(selectedPlace: PlaceDetail | null, multiValuedData: GeometryQueryResult | null = null) {
  const [syncState, setSyncState] = useState<SyncState>({
    graphLocked: false,
    frozenPlace: null,
    frozenGraphData: null,
  });

  const toggleGraphLock = useCallback(() => {
    setSyncState((prev) => {
      if (prev.graphLocked) {
        // UNLOCK: clear frozen snapshot, graph will sync to current selectedPlace
        return {
          ...prev,
          graphLocked: false,
          frozenPlace: null,
          frozenGraphData: null,
        };
      } else {
        // LOCK: snapshot current graph (prefer multi-valued data)
        let snapshot: GraphData | null = null;
        if (multiValuedData && multiValuedData.places.length > 0) {
          snapshot = buildGraphFromMultiValuedData(multiValuedData);
        } else if (selectedPlace) {
          snapshot = buildGraphFromPlace(selectedPlace);
        }
        return {
          ...prev,
          graphLocked: true,
          frozenPlace: selectedPlace,
          frozenGraphData: snapshot,
        };
      }
    });
  }, [selectedPlace, multiValuedData]);

  // Resolve which graph data to display
  const activeGraphData = useMemo(() => {
    if (syncState.graphLocked) {
      return syncState.frozenGraphData;
    }
    // ONLY use multi-valued data — don't show old single-place graph
    if (multiValuedData && multiValuedData.places.length > 0) {
      return buildGraphFromMultiValuedData(multiValuedData);
    }
    // Return null — graph shows loading/empty state until multi-valued data arrives
    return null;
  }, [syncState.graphLocked, syncState.frozenGraphData, multiValuedData]);

  // Resolve which place's geometry to use for graph node clicks
  const activePlace = syncState.graphLocked
    ? syncState.frozenPlace
    : selectedPlace;

  // Resolve which place name to show in graph header
  const activeGraphPlaceName = syncState.graphLocked
    ? syncState.frozenPlace?.name || ""
    : selectedPlace?.name || "";

  return {
    syncState,
    toggleGraphLock,
    activeGraphData,
    activePlace,
    activeGraphPlaceName,
  };
}
