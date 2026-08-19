/** Fetches a node's full attribute list (properties + rdf:types) for a URI, via panelPropertiesStore cache or expandNode on-demand — keyed by URI, not "what's selected" (see useSelectedGraphNode, which wraps this for DataPanel's Selected Node section). */

import { useEffect, useState } from "react";
import { panelPropertiesStore } from "../services/expansionHandlers";
import { expandNode, resolveResourceChains } from "../services/genericExpansion";
import { isInternalPnkgUri } from "../services/labelExtractor";
import type { PanelProperty } from "../types/graph";

export interface UseNodeDetailReturn {
  properties: PanelProperty[];
  rdfTypes: string[];
}

export function useNodeDetail(uri: string | null): UseNodeDetailReturn {
  const [properties, setProperties] = useState<PanelProperty[]>([]);
  const [rdfTypes, setRdfTypes] = useState<string[]>([]);

  useEffect(() => {
    if (!uri) {
      setProperties([]);
      setRdfTypes([]);
      return;
    }

    const nodeUri = uri;
    let cancelled = false;

    // Enriches URI-valued properties with a one-hop resolve (resolveResourceChains), used by both NodeDetailBody's inline chains and LinkedResourceSection's titles — skips already-resolved props and caches results in panelPropertiesStore.
    function enrichWithChains(nodeUri: string, props: PanelProperty[]) {
      const candidates = props.filter(
        (p) => p.valueType === 'uri'
          && isInternalPnkgUri(p.value)
          && p.resolvedProperties === undefined
      );
      if (candidates.length === 0) return;

      resolveResourceChains(candidates.map((p) => p.value)).then((chains) => {
        if (cancelled) return;
        const enriched = props.map((p) => {
          if (!candidates.includes(p)) return p;
          const chain = chains.get(p.value);
          return { ...p, resolvedType: chain?.type, resolvedProperties: chain?.properties ?? [] };
        });
        setProperties(enriched);
        panelPropertiesStore.set(nodeUri, enriched);
      });
    }

    // Check if properties are already cached in panelPropertiesStore
    const cached = panelPropertiesStore.get(nodeUri);
    if (cached) {
      setProperties(cached);
      // Collect ALL rdf:type values from cached properties
      const RDF_TYPE_PRED = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
      const cachedTypes = cached
        .filter(p => p.predicate === RDF_TYPE_PRED && p.valueType === 'uri')
        .map(p => p.value);
      setRdfTypes(cachedTypes);
      enrichWithChains(nodeUri, cached);
      return () => { cancelled = true; };
    }

    // Not in store — fetch via expandNode. existingNodeUris is deliberately empty: it only shapes graphNodes, which this hook never reads (GraphPanel's own expand() still passes the real set for the canvas).
    expandNode(nodeUri, new Set())
      .then((classified) => {
        if (cancelled) return;
        const props = classified.panelProperties;
        setProperties(props);
        const types = classified.sourceRdfTypes ?? (classified.sourceRdfType ? [classified.sourceRdfType] : []);
        setRdfTypes(types);
        // Store in panelPropertiesStore for future access
        if (props.length > 0) {
          panelPropertiesStore.set(nodeUri, props);
        }
        enrichWithChains(nodeUri, props);
      })
      .catch(() => {
        if (cancelled) return;
        setProperties([]);
        setRdfTypes([]);
      });

    return () => { cancelled = true; };
  }, [uri]);

  return { properties, rdfTypes };
}
