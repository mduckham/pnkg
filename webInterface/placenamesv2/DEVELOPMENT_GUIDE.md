# Development Guide

Practical reference for changing, testing, and deploying this codebase.

## Stay graph-driven

The one rule that matters most: **never hardcode which RDF predicates or
resource types exist in a component.** The backend ontology is expected to
evolve, and a new resource type should show up in the Knowledge Graph canvas
and the Place Information panel — titled, coloured, expandable — with zero
frontend code changes. Put ontology-specific logic in `src/config/`
(`presentationRules.ts`, `appConfig.ts`) instead of an `if (predicate ===
'http://...')` branch. If it genuinely can't be generic, prefer a
namespace-level check over a hardcoded predicate/type list — it still
generalises to whatever the backend adds later.

## Where a change goes

| Change | Touch |
|---|---|
| Colour, SPARQL endpoint, ontology display names, node styling | `src/config/appConfig.ts` |
| How a predicate is classified/labelled | `src/config/presentationRules.ts` |
| Numeric limits (node budget, expansion depth, timeouts, durations) | `src/config/graphConfig.ts` |
| New RDF resource type in the panel | Usually nothing — discovery is generic (`LinkedResourceSection.tsx`) |
| New SPARQL query | `sparqlQueries.ts` + a parser in `placeService.ts`/`useMultiValuedPlace.ts` |
| Place Information panel structure | `MultiValuedPlacePanel.tsx` / `LinkedResourceSection.tsx` |
| New map layer/interaction | `useMapInit.ts` |

## Conventions

- `components/` = JSX, `hooks/` = stateful logic, `services/`/`utils/` = no
  React, `config/` = data not logic.
- No global store — state lifts to `App.tsx`, passed down as props.
- Cytoscape is imperative — the canvas is created once and mutated directly
  (`cy.add()`, `.addClass()`, ...) from event handlers, never React-rendered.
- One shared cache (`panelPropertiesStore` in `expansionHandlers/index.ts`) —
  check it before adding a new fetch path for a resource's triples.

## Before shipping a change

```bash
npx tsc --noEmit && npx tsc -b --force && npm run build && npm run lint
```
`tsc -b` (project-references mode) is stricter than `tsc --noEmit` and is
what Vercel's build actually runs — a change can pass the loose check and
still fail here. `npm run lint` runs `oxlint`. Then verify in the browser:
there's no automated test suite wired up (`vitest`/`playwright` are
installed but unused), so a clean build proves the code compiles, not that
the feature works.

## Git

No enforced commit convention — short, present-tense messages describing
*why* over *what*, one logical change per commit.

## Known rough edges

- Production bundle warns about size (chunks >500kB) — Cytoscape.js and
  MapLibre are the two big contributors, never code-split. Not urgent.
- `cytoscape-fcose` is an unused dependency, left from an earlier
  force-directed layout that was tried and reverted. Safe to remove.
- No automated tests, no CI — manual browser verification plus the build
  checks above is the current safety net for every change.
- Git history is not very informative (`v3`, `f`, `placename`) — worth
  writing real commit messages going forward.

## Deployment

### Environment variables

Both optional — the app runs with sensible fallbacks (`src/config/appConfig.ts`):

| Variable | Used for | If unset |
|---|---|---|
| `VITE_MAPTILER_KEY` | MapTiler basemap (terrain shading) | Falls back to OpenFreeMap Liberty |
| `VITE_SPARQL_ENDPOINT` | Overrides the `/sparql` path | Defaults to `/sparql` — correct for dev and prod |

Locally: copy `.env.local.example` → `.env.local` and add your own MapTiler
key ([maptiler.com](https://www.maptiler.com/)), gitignored. On Vercel: set
`VITE_MAPTILER_KEY` in the project's Environment Variables (Production +
Preview) if you want the MapTiler basemap live.

### The SPARQL endpoint is hardcoded, not an env var

```ts
// api/sparql.ts, mirrored in vite.config.ts's dev proxy target/rewrite
const FUSEKI_ENDPOINT = "https://placenames.org/fuseki/geo20260709";
```
If the Fuseki server or dataset name ever moves, edit both directly. A proxy
is still required even over `https://` — Fuseki doesn't send CORS headers
for arbitrary origins, so the browser can't call it cross-origin directly.

### Deploying to Vercel

`vercel.json` is already configured (`buildCommand: npm run build`,
`outputDirectory: dist`, a rewrite of `/sparql` → `/api/sparql`). Connect the
repo to Vercel (or run `vercel` from the CLI), set `VITE_MAPTILER_KEY` if
wanted, then push to the watched branch (or `vercel --prod`). `api/sparql.ts`
becomes a serverless function automatically — Vercel's file-based
convention, any file under `api/` exporting a default `handler`.

### Pre-deploy checklist

- [ ] `git status` clean and pushed to the branch Vercel is watching.
- [ ] `npx tsc -b --force && npm run build` passes locally.
- [ ] Load the deployed site: map renders, search returns results, clicking
      a place opens the Place Information panel, the Knowledge Graph canvas
      populates, and double-clicking a node expands it.
- [ ] If replacing the current placenames.org site: DNS/hosting is a
      separate concern from this repo's config — the Fuseki *backend* is
      already reachable at `https://placenames.org/fuseki/...` regardless of
      where this *frontend* ends up deployed.

### Rolling back

Vercel keeps every previous deployment — promoting an older one back to
production is a dashboard action (or `vercel rollback`), not a git revert.
