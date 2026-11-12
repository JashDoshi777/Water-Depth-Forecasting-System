import axios from 'axios';

const api = axios.create({
  baseURL: '/api/v1',
  timeout: 60000, // 60s for slow endpoints
  headers: { 'Content-Type': 'application/json' },
});

// ── Simple in-memory cache with TTL ──
const _cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCached(key) {
  const entry = _cache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data;
  return null;
}

function setCache(key, data) {
  _cache.set(key, { ts: Date.now(), data });
}

async function cachedGet(url, params = {}, ttl = CACHE_TTL) {
  const key = url + JSON.stringify(params);
  const cached = getCached(key);
  if (cached) return cached;
  const res = await api.get(url, { params });
  setCache(key, res.data);
  return res.data;
}

async function cachedPost(url, body = {}, ttl = CACHE_TTL) {
  const key = url + JSON.stringify(body);
  const cached = getCached(key);
  if (cached) return cached;
  const res = await api.post(url, body);
  setCache(key, res.data);
  return res.data;
}

// ── DIGIPIN ──
export const encodeDIGIPIN = (latitude, longitude) =>
  api.post('/digipin/encode', { latitude, longitude }).then(r => r.data);

export const decodeDIGIPIN = (digipin) =>
  api.post('/digipin/decode', { digipin }).then(r => r.data);

// ── Depth (cached per DIGIPIN for 5 min) ──
export const getCurrentDepth = (params) =>
  cachedPost('/depth/current', params);

export const getDepthForecast = (params) =>
  cachedPost('/depth/forecast', params);

export const getDepthHistory = (digipin, hours = 72) =>
  cachedGet(`/depth/history/${digipin}`, { hours });

export const getSatelliteData = (digipin) =>
  cachedGet(`/depth/satellite/${digipin}`);

// ── Weather (cached) ──
export const getWeather = (params) =>
  cachedGet('/weather/current', params);

export const getTide = (params) =>
  cachedGet('/weather/tide', params);

export const getTideExtremes = (latitude, longitude, days = 3) =>
  cachedGet('/weather/tide/extremes', { latitude, longitude, days });

export const getWeatherForecast = (params) =>
  cachedGet('/weather/forecast', params);

export const getHistoricalWeather = (latitude, longitude, days_back = 30) =>
  cachedGet('/weather/historical', { latitude, longitude, days_back });

export const getWeatherSatellite = (latitude, longitude) =>
  cachedGet('/weather/satellite', { latitude, longitude });

// ── Locations (cached) ──
export const getAllLocations = (limit = 100, offset = 0, water_body_type = '') =>
  cachedGet('/locations/all', { limit, offset, water_body_type });

export const searchLocations = (q, water_body_type = '') =>
  cachedGet('/locations/search', { q, water_body_type });

export const getNearbyLocations = (latitude, longitude, radius_km = 100) =>
  cachedGet('/locations/nearby', { latitude, longitude, radius_km });

export const getLocationDetail = (digipin) =>
  cachedGet(`/locations/detail/${digipin}`);

export const getLocationsBbox = (lat_min, lat_max, lon_min, lon_max, limit = 200) =>
  cachedGet('/locations/bbox', { lat_min, lat_max, lon_min, lon_max, limit });

export const getLocationStats = () =>
  cachedGet('/locations/stats');

export const getLocationsGeoJSON = () =>
  api.get('/locations/geojson').then(r => r.data);  // Skip frontend cache — backend caches this

// ── Flood / Alerts (cached) ──
export const getFloodRisk = (params) =>
  cachedGet('/flood/risk', params);

export const getActiveAlerts = () =>
  cachedGet('/alerts/active');

// ── Analytics (cached) ──
export const getAnalyticsOverview = () =>
  cachedGet('/analytics/overview');

export const getDepthDistribution = () =>
  cachedGet('/analytics/depth-distribution');

export const getHistoricalRainfall = (latitude, longitude, days = 90) =>
  cachedGet('/analytics/historical-rainfall', { latitude, longitude, days });

export const getSeasonalAnalysis = (latitude, longitude) =>
  cachedGet('/analytics/seasonal', { latitude, longitude });

// ── System ──
export const getSystemStatus = () =>
  api.get('/system/status').then(r => r.data);

export default api;

// Search with a larger result window (API returns at most `limit` matches, no offset).
export const searchLocationsLimit = (q, water_body_type = '', limit = 500) =>
  cachedGet('/locations/search', { q, water_body_type, limit });

// ── ML ──
export const getMLOverview = () => api.get('/ml/overview').then(r => r.data);
export const mlForecast = (body) => api.post('/ml/forecast', body).then(r => r.data);
export const mlFlood = (body) => api.post('/ml/flood', body).then(r => r.data);
export const mlStaticDepth = (body) => api.post('/ml/static-depth', body).then(r => r.data);
