/** Reads the precomputed recommendedZoom property straight off the PMTiles file for a geometry URI + coordinate — replaces a live SPARQL COUNT query that raced a timeout and could land on a different zoom tier purely from network timing. */
import { PMTiles } from "pmtiles";
import { VectorTile } from "@mapbox/vector-tile";
import Pbf from "pbf";
import { appConfig } from "../config/appConfig";

/** Matches useMapInit.ts's "source-layer": "placenames" — every geometry type lives in this one vector tile layer. */
const SOURCE_LAYER = "placenames";

let pmtilesInstance: PMTiles | null = null;
function getPmtilesInstance(): PMTiles {
  if (!pmtilesInstance) {
    // Plain https URL, not the "pmtiles://" protocol — that's only for MapLibre's addProtocol.
    pmtilesInstance = new PMTiles(`${window.location.origin}${appConfig.pmtilesUrl}`);
  }
  return pmtilesInstance;
}

/** The tileset's maxzoom, fetched once and reused — always queried AT this zoom since tippecanoe's feature-dropping is least aggressive there. */
let maxZoomPromise: Promise<number> | null = null;
function getMaxZoom(): Promise<number> {
  if (!maxZoomPromise) {
    maxZoomPromise = getPmtilesInstance()
      .getHeader()
      .then((h) => h.maxZoom);
  }
  return maxZoomPromise;
}

/** Standard Web Mercator slippy-map tile math. */
function lngLatToTile(lng: number, lat: number, z: number): { x: number; y: number } {
  const x = Math.floor(((lng + 180) / 360) * 2 ** z);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * 2 ** z
  );
  return { x, y };
}

/** Decoded-tile cache keyed by "z/x/y" (also caches misses) — browsing nearby places often re-hits the same tile; session-lifetime, module-level. */
const tileCache = new Map<string, VectorTile | null>();

async function getDecodedTile(z: number, x: number, y: number): Promise<VectorTile | null> {
  const key = `${z}/${x}/${y}`;
  const cached = tileCache.get(key);
  if (cached !== undefined) return cached;
  const resp = await getPmtilesInstance().getZxy(z, x, y);
  const tile = resp ? new VectorTile(new Pbf(resp.data)) : null;
  tileCache.set(key, tile);
  return tile;
}

/** Kicks off the PMTiles header fetch early (call once on app mount) so getMaxZoom's cold-start cost isn't on the critical path of the user's first click; safe to call multiple times since getMaxZoom caches. */
export function preloadRecommendedZoomService(): void {
  getMaxZoom().catch(() => {});
}

/** Reads recommendedZoom for a geometry URI at a known coordinate; returns null if not found (absent feature, or network/decode failure) — callers fall back to a fixed zoom. */
export async function getRecommendedZoom(
  uri: string,
  coords: [number, number]
): Promise<number | null> {
  try {
    const maxZoom = await getMaxZoom();
    const { x, y } = lngLatToTile(coords[0], coords[1], maxZoom);
    const tile = await getDecodedTile(maxZoom, x, y);
    const layer = tile?.layers[SOURCE_LAYER];
    if (!layer) return null;
    for (let i = 0; i < layer.length; i++) {
      const feature = layer.feature(i);
      if (feature.properties.id === uri) {
        const rz = feature.properties.recommendedZoom;
        return typeof rz === "number" ? rz : null;
      }
    }
    return null;
  } catch {
    return null;
  }
}
