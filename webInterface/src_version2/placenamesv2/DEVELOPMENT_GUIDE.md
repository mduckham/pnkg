# Development Guide

This assumes you've already read `README.md` (what this is, how to run it).
This guide is for someone who needs to **understand, maintain, and extend**
the app: how it actually works, where to make a given kind of change, what
rules to follow, and how to verify a change safely.

## 1. How the application works

Data flow, end to end:

```
SPARQL / Fuseki  →  services  →  hooks / app state  →  Knowledge Graph canvas
                                                      ↘  Place Information panel
                                                      ↘  map
```

- A map click or a search resolves to a place, fetched by
  `src/services/placeService.ts` (`getPlaceDetails`, `searchPlaces`), which
  builds queries in `sparqlQueries.ts` and runs them through
  `sparqlService.ts`.
- Independently, `src/hooks/useMultiValuedPlace.ts` fetches *every* name,
  geometry, and cross-border place sharing that same location and groups the
  results by place URI into a `MultiValuedPlace` object — this is what
  handles a place having more than one name or geometry.
- `App.tsx` holds this as state and feeds it to two places at once:
  `src/services/graphBuilder.ts` turns it into the initial Knowledge Graph
  nodes/edges, and `MultiValuedPlacePanel.tsx` renders it as the Place
  Information panel. Both come from the **same fetch**, which is why the map,
  graph, and panel always stay in sync.
- `GraphPanel.tsx` lays the initial graph out (a deterministic radial-tree
  layout, `src/services/graphLayout.ts`) and renders it in Cytoscape.

## 2. Knowledge Graph development

**Expansion (clicking a node).** A single click auto-expands most node
types; cross-border (`skos:exactMatch`) nodes need a double-click instead,
so you don't pull in another place's whole subgraph by accident.
Double-clicking any node recursively expands its whole reachable subtree.

The expansion pipeline:
```
useGraphExpansion.ts (budget/already-expanded/in-flight guards)
  → expansionRegistry.ts (picks a handler by node type)
  → genericExpansion.ts (fetches that node's SPARQL triples)
  → presentationLayer.ts's classifyTriples() (sorts each triple into a
    graph node vs. a panel-only property, per presentationRules.ts)
```
Every node type currently shares the *same* generic handler
(`src/services/expansionHandlers/index.ts`) — there's no per-type expansion
logic to maintain.

**Configuring types, predicates, colours, labels** — all data, not code:
- Colour/label per node type: `src/config/appConfig.ts` (`nodeTypes`) — the
  single source of truth for both the canvas and the panel's coloured dots.
- Whether a predicate shows on the canvas, panel-only, or both, plus its
  display name/category: `src/config/presentationRules.ts`.
- Node size/shape/text wrapping: `src/services/graphNodeStyles.ts`.

**The rule that matters most:** the UI must never hardcode which RDF
predicates or resource types exist. The backend ontology is expected to
evolve, and a new type it adds should show up on the canvas and in the
panel — titled, coloured, expandable — with **zero component changes**.
Put ontology-specific logic in `presentationRules.ts`/`appConfig.ts`, never
in an `if (predicate === 'http://...')` branch inside a component.

**Duplicate resources.** Nodes are identified by URI. If an expansion
reveals a URI that's already on the canvas, no second node is created — the
new edge is redirected to the existing node instead.

**Cycles.** The graph is not a tree: the same resource can be reached more
than one way, and real cycles exist (e.g. a cross-border chain
A → B → A). This is handled explicitly, not assumed away:
- On canvas, cross-border nodes are expansion boundaries — a recursive
  double-click expansion stops at them instead of looping.
- In the panel, a `visitedPlaceUris` set (cross-border chains) and a
  depth-capped expanded-tracker (`GRAPH_CONFIG.MAX_LINKED_RESOURCE_DEPTH`,
  generic nested resources) stop recursion and show "Already shown above"
  instead of re-fetching or re-rendering.

## 3. Place Information panel

`MultiValuedPlacePanel.tsx` renders every place in a fixed order:

1. **Place** — classification badge + its own literal properties, always
   visible.
2. **Name** — the active name's own properties, always expanded, with a
   "More details…" toggle revealing anything it links to further out.
3. **Geometry** — same pattern, with a picker if the place has more than
   one geometry.
4. **Other names for this place** — collapsible; each expands into the same
   detail view as the primary name.
5. **Cross-border** — shown only if the place has `skos:exactMatch`
   matches; each one expands into a full nested copy of this same panel,
   recursively — a cross-border place can itself have its own cross-border
   places.

**Nested resources** — Metadata, Publisher, Location, Place Naming
Authority — are **not** separate top-level sections. They're discovered
generically from whatever a Name or Geometry resource itself links to, and
rendered nested inside it behind "More details…"
(`LinkedResourceSection.tsx`). Nothing here is hardcoded per resource type;
it's driven by the same `presentationRules.ts` config the canvas uses.

**Clicking a Knowledge Graph node → panel.** `DataPanel.tsx` first tries a
fast path: does the clicked URI directly match one of this place's own
names/geometries/cross-border entries (`resolvePanelSection.ts`)? If the
node is nested deeper, it falls back to `findResourcePath.ts`, which walks
the same generic resource tree from every Name/Geometry as a root until it
finds the clicked URI, then opens every section along that path and scrolls
to it.

## 4. Where developers should make changes

| If you want to change... | Look here |
|---|---|
| KG colours/types/labels | `src/config/appConfig.ts` |
| RDF predicate presentation (graph vs. panel-only, category, display name) | `src/config/presentationRules.ts` |
| Graph layout | `src/services/graphLayout.ts` |
| Expansion behaviour (limits, timeouts, budgets) | `src/config/graphConfig.ts`; orchestration in `src/hooks/useGraphExpansion.ts`; the fetch/classify itself in `src/services/genericExpansion.ts` |
| Place Information panel structure | `src/components/MultiValuedPlacePanel.tsx` |
| Nested/recursive resource rendering | `src/components/LinkedResourceSection.tsx` |
| A new SPARQL query | `src/services/sparqlQueries.ts` (+ a parser in `placeService.ts`/`useMultiValuedPlace.ts`) |
| Shared types | `src/types/place.ts`, `src/types/graph.ts` |
| Map behaviour | `src/components/MapView.tsx`, `src/hooks/useMapInit.ts`, `src/hooks/useMapGraphSync.ts` |

## 5. Important development conventions

- Keep ontology-specific presentation rules in `presentationRules.ts`/
  `appConfig.ts` — never hardcode an RDF predicate or resource type inside
  a component.
- Reuse an existing graph node when its URI is already on the canvas,
  rather than creating a duplicate.
- Preserve relationships even when a resource is shared or the graph has a
  cycle — don't assume the graph is a tree.
- Reuse the existing caching/data-fetching hooks (`useNodeDetail.ts`, the
  shared `panelPropertiesStore` in `expansionHandlers/index.ts`) instead of
  adding a second fetch path for the same kind of data.
- Keep the layering: `components/` = JSX, `hooks/` = stateful logic,
  `services/`/`utils/` = no React, `config/` = data not logic. No global
  store — state lifts to `App.tsx` and passes down as props. Cytoscape is
  imperative (`cy.add()`, `.addClass()`, ...) — never try to make the
  canvas a function of React state the way the rest of the UI is.

## 6. Testing and verification

There's no automated test suite wired up yet (`vitest`/`@playwright/test`
are installed but unused — no config, no test files, no CI), so verification
is: the build checks below, then manual browser testing.

```bash
npx tsc --noEmit && npx tsc -b --force && npm run build && npm run lint
```
`tsc -b` (project-references mode) is the strict check Vercel's build
actually runs — a change can pass `tsc --noEmit` and still fail here.

Scenarios worth checking by hand after a graph/panel change:
- Expanding a node, and clicking a node that's already on the canvas
  (should reuse it, not duplicate it).
- A nested resource (Metadata/Publisher/Location under a Name or Geometry).
- Cross-border → cross-border (a cross-border place that itself has
  cross-border matches).
- A cyclic relationship (A → B → A) — should stop and show "already shown,"
  not loop or crash.
- A place with multiple names/geometries — the picker, "Other names," and
  "Also at this location."
- Clicking a Knowledge Graph node nested several levels deep — confirm the
  panel opens and scrolls to the right section.

## 7. Deployment

**Environment variables** (`src/config/appConfig.ts`) — both optional:

| Variable | Used for | If unset |
|---|---|---|
| `VITE_MAPTILER_KEY` | MapTiler basemap | Falls back to OpenFreeMap |
| `VITE_SPARQL_ENDPOINT` | Overrides the `/sparql` path | Defaults to `/sparql` — correct for both dev and prod |

**The SPARQL endpoint itself is not an environment variable** — it's a
constant in `api/sparql.ts` (`FUSEKI_ENDPOINT`), mirrored in
`vite.config.ts`'s dev proxy. If the Fuseki server or dataset name changes,
both need editing directly. A proxy is required either way, since Fuseki
doesn't send CORS headers for arbitrary origins.

**Deploying to Vercel** — `vercel.json` is already configured (build
command, output directory, a `/sparql` → `/api/sparql` rewrite). Push to
the connected branch (or `vercel --prod`); `api/sparql.ts` becomes a
serverless function automatically. Before calling a deploy done, confirm
`/sparql?query=...` on the deployed domain returns real data, and click
through: map renders, search works, a place click opens the panel, and the
Knowledge Graph canvas expands.

## 8. Troubleshooting

| Problem | Where to look |
|---|---|
| A node doesn't expand on click | `useGraphExpansion.ts` guards — is it already expanded/terminal, over the node budget, or already in flight? |
| Panel doesn't open or scroll to the clicked node | `resolvePanelSection.ts` (fast path) / `findResourcePath.ts` (fallback walk) — confirm the node's URI is actually reachable from a Name/Geometry root |
| A node appears duplicated | Check URI deduplication — `presentationLayer.ts`'s `seenGraphUris`/`existingNodeUris`, `useGraphExpansion.ts`'s existing-node redirect |
| A nested or cross-border resource won't expand further | Likely the cycle/depth guard — `visitedPlaceUris` (cross-border) or `GRAPH_CONFIG.MAX_LINKED_RESOURCE_DEPTH` (generic nested resources) doing its job |
| A SPARQL request fails | Check the Network tab for the `/sparql` request — dev proxies via `vite.config.ts`, prod via `api/sparql.ts` — and confirm the Fuseki endpoint is reachable |
| `npm run build` fails but `tsc --noEmit` passed | `tsc -b` (what Vercel actually runs) is stricter — run `npx tsc -b --force` locally to see the real error |
