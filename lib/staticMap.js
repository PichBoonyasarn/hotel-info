const { withRetry } = require('./retry');

const STATIC_MAP_URL = 'https://maps.googleapis.com/maps/api/staticmap';

// Markers and path points both blow up a Static Maps URL fast (each marker/
// point is its own query-string entry) — Google's hard limit is ~8192 chars
// for the whole URL. These caps keep a worst-case request (15 markers + a
// long polyline) comfortably under that without needing to measure the
// actual URL length.
const MAX_MARKERS = 15;
const MAX_PATH_POINTS = 100;

// Reduces a path to at most `max` points by taking every Nth point, always
// keeping the first and last (start/end matter most for a route line) —
// same "thin out, don't just truncate" approach as routePlanning.js's
// samplePoints(), just simpler since this only needs visual fidelity, not
// even spacing for a search radius.
function thinPath(path, max) {
  if (!path || path.length <= max) return path || [];
  const step = (path.length - 1) / (max - 1);
  const thinned = [];
  for (let i = 0; i < max; i++) thinned.push(path[Math.round(i * step)]);
  return thinned;
}

// `markers`: [{ lat, lng, label, color }] — color is any Static Maps color
// name/hex (e.g. 'red', 'blue', '0x4a6354'); label must be a single
// uppercase letter/digit per Google's API, omitted if not provided.
// `path`: [{ lat, lng }, ...] — drawn as one polyline.
function buildStaticMapUrl({ markers = [], path = [], size = '600x400', scale = 2 }, apiKey) {
  const params = new URLSearchParams();
  params.set('size', size);
  params.set('scale', String(scale));
  params.set('key', apiKey);

  for (const m of markers.slice(0, MAX_MARKERS)) {
    if (m.lat == null || m.lng == null) continue;
    const style = [
      m.color ? `color:${m.color}` : null,
      m.label ? `label:${m.label}` : null,
      `${m.lat},${m.lng}`,
    ].filter(Boolean).join('|');
    params.append('markers', style);
  }

  const thinned = thinPath(path, MAX_PATH_POINTS);
  if (thinned.length) {
    const pathStr = ['color:0x4a6354', 'weight:4']
      .concat(thinned.map(p => `${p.lat},${p.lng}`))
      .join('|');
    params.set('path', pathStr);
  }

  return `${STATIC_MAP_URL}?${params.toString()}`;
}

// Fetches the actual image bytes server-side, so GOOGLE_MAPS_KEY never
// reaches the browser — same reasoning as routes/poi.js's /photo proxy.
async function fetchStaticMapImage(opts, apiKey) {
  const url = buildStaticMapUrl(opts, apiKey);
  return withRetry(async () => {
    const r = await fetch(url);
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      throw new Error(`Static Maps API: ${r.status} ${body.slice(0, 200)}`);
    }
    return Buffer.from(await r.arrayBuffer());
  }, { attempts: 3, delayMs: 800 });
}

module.exports = { buildStaticMapUrl, fetchStaticMapImage, MAX_MARKERS, MAX_PATH_POINTS };
