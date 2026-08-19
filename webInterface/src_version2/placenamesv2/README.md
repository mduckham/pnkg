# placenamesv2: Australian Place Name Knowledge Graph — web app

This is the **web application** described in the
[pnkg](https://github.com/mduckham/pnkg) root README's "Web Interface"
section — the map, Knowledge Graph Explorer, and place detail panel, also
reachable by searching a place name, not just clicking one on the map. It
does not build the knowledge graph itself; see the repository root for the
RML mappings and data processing that turn state gazetteer CSVs into the
RDF graph this app queries, the ontology, and full project acknowledgments.

## Documentation

**[`DEVELOPMENT_GUIDE.md`](./DEVELOPMENT_GUIDE.md)** covers this project's
conventions, what to check before calling a change done, and how to deploy
it (environment variables, the Fuseki endpoint, Vercel setup).

## Quick start

```bash
npm install
cp .env.local.example .env.local   # add your own MapTiler key (optional — falls back to OpenFreeMap)
npm run dev
```

Open the printed localhost URL. The dev server proxies `/sparql` requests to
the Fuseki SPARQL endpoint directly (see `vite.config.ts`) — no backend of
your own to run.

```bash
npm run build     # tsc -b && vite build — the same command Vercel runs
npm run preview   # serve the production build locally
npm run lint       # oxlint
```

## Tech stack

| Tech | Role |
|---|---|
| React 19 + TypeScript | UI |
| Vite | Dev server + bundler |
| MapLibre GL JS + PMTiles | Map rendering (static vector tiles, no tile server) |
| Cytoscape.js | Knowledge Graph canvas |
| Apache Jena Fuseki | RDF triple store + SPARQL endpoint (external, not part of this repo) |
| Vercel | Hosting + a one-file serverless CORS proxy to Fuseki |
| Tailwind CSS v4 | Styling |

## Repository structure

```
placenamesv2/
├── api/sparql.ts        ← production CORS proxy to Fuseki (Vercel function)
├── public/               ← static assets, incl. the PMTiles map-tile file (see DEVELOPMENT_GUIDE.md)
├── src/
│   ├── components/        ← React UI
│   ├── hooks/              ← stateful logic
│   ├── services/           ← pure data/SPARQL/graph-building functions, no React
│   ├── config/              ← colours, endpoints, ontology info — the "generalise to another KG" seam
│   ├── types/                ← shared TypeScript types
│   └── utils/                 ← small single-purpose helpers
├── vite.config.ts        ← dev server + dev-mode SPARQL proxy
└── vercel.json            ← production build/proxy config
```

## The PMTiles map-tile file

`public/placenames-recommendedzoom.pmtiles` follows the same pipeline as
[pnkg's own webInterface build](https://github.com/mduckham/pnkg/blob/main/webInterface/README.md#techical-workflow-and-dependencies)
— Turtle → GeoJSON → MBTiles (tippecanoe) → PMTiles — with one addition:
every Point feature also carries a `recommendedZoom` number, computed from
the density of nearby points (denser areas get a closer recommended zoom,
sparser areas a further one). The app reads it in
`src/services/recommendedZoomService.ts` to pick a place's initial zoom
without a live query. The tile layer's only properties are `id` and
`recommendedZoom` — no `wkt`, since MVT tiles carry point geometry natively.

## Configuration — no code changes needed for a different dataset

Per `src/config/appConfig.ts`'s own header comment, this app is meant to be
**generalisable**: colours, the SPARQL endpoint, node types, and ontology
metadata all live in `src/config/`, not hardcoded through the components.
Adapting this UI for a different knowledge graph should mean editing config,
not rewriting components.

## Acknowledgments

See the [repository root](https://github.com/mduckham/pnkg) for full project
acknowledgments.
