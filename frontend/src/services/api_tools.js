import api from './api';

/** Small TTL + in-flight de-dupe cache so cards, compare and the notifier share requests. */
const store = new Map();
const TTL = 5 * 60 * 1000;
function memo(key, fn, ttl = TTL) {
  const hit = store.get(key);
  if (hit && Date.now() - hit.ts < ttl) return hit.p;
  const p = fn();
  store.set(key, { ts: Date.now(), p });
  p.catch(() => store.delete(key));
  return p;
}

export const searchPlaces = (q, type = '', limit = 8) =>
  api.get('/locations/search', { params: { q, water_body_type: type, limit } }).then((r) => r.data);

/** Turn a search hit into a watchlist-shaped item. */
export const toItem = (r, city) => ({
  digipin: r.digipin, lat: r.latitude, lon: r.longitude, type: r.water_body_type, region: r.region,
  name: city ? `${city} · ${r.name}` : r.name,
});

export const placeDetail = (digipin) => memo(`d:${digipin}`, () => api.get(`/locations/detail/${digipin}`).then((r) => r.data));
export const depthNow = (digipin) => memo(`c:${digipin}`, () => api.post('/depth/current', { digipin }).then((r) => r.data));
export const forecast48 = (digipin) => memo(`f:${digipin}`, () => api.post('/ml/forecast', { digipin, hours_ahead: 48 }).then((r) => r.data));
export const floodNow = (digipin, fresh = false) => memo(`r:${digipin}`, () => api.post('/ml/flood', { digipin }).then((r) => r.data), fresh ? 0 : TTL);
export const safetyFor = (digipin, activity) => memo(`s:${digipin}:${activity}`, () => api.get('/safety', { params: { digipin, activity } }).then((r) => r.data), 2 * 60 * 1000);
