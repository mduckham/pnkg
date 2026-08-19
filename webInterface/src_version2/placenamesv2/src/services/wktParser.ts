/** Parses WKT (Well-Known Text) geometry strings from SPARQL, e.g. "POINT(146.6 -37.3)". */

/** Extracts a [lng, lat] coordinate from a WKT string (POINT/MULTIPOINT/POLYGON/MULTIPOLYGON/LINESTRING); for polygons/lines returns the first point as an approximate center. */
export function getCoordinatesFromWkt(wkt: string): [number, number] | null {
  if (!wkt) return null;

  try {
    // Match the first coordinate pair (lng lat) — WKT format: POINT(lng lat) or POLYGON((lng lat, ...))
    const match = wkt.match(/([-\d.]+)\s+([-\d.]+)/);
    if (match) {
      const lng = parseFloat(match[1]);
      const lat = parseFloat(match[2]);
      if (!isNaN(lng) && !isNaN(lat)) {
        return [lng, lat];
      }
    }
  } catch {
    // ignore parse errors
  }

  return null;
}

/** Extracts every [lng, lat] coordinate pair from a WKT string, used to compute a bounding box over the whole geometry rather than just the first vertex (see getCoordinatesFromWkt for the single-point case). */
export function getAllCoordinatesFromWkt(wkt: string): [number, number][] {
  if (!wkt) return [];

  const coords: [number, number][] = [];
  const regex = /(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(wkt)) !== null) {
    const lng = parseFloat(match[1]);
    const lat = parseFloat(match[2]);
    if (!isNaN(lng) && !isNaN(lat)) {
      coords.push([lng, lat]);
    }
  }
  return coords;
}

/** Label text for a geo:asWKT literal — a Point's WKT is short and shown in full; Polygon/LineString WKT can run to hundreds of vertices, so those preview the first MAX_PREVIEW_COORDS coordinate pairs (not raw characters, which could cut a number in half) plus "…". */
const MAX_PREVIEW_COORDS = 6;

export function formatWktLabel(wkt: string): string {
  if (!wkt) return wkt;
  const trimmed = wkt.trim();
  if (trimmed.toUpperCase().startsWith('POINT')) return trimmed;

  const typeMatch = trimmed.match(/^([A-Za-z]+)/);
  const type = typeMatch ? typeMatch[1].toUpperCase() : '';

  const coordRegex = /-?\d+(?:\.\d+)?\s+-?\d+(?:\.\d+)?/g;
  const pairs: string[] = [];
  let match: RegExpExecArray | null;
  while (pairs.length < MAX_PREVIEW_COORDS && (match = coordRegex.exec(trimmed)) !== null) {
    pairs.push(match[0]);
  }
  if (pairs.length === 0) return trimmed;

  return `${type}(${pairs.join(', ')}, …)`;
}
