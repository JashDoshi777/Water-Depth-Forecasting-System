import api from './api';

// Validation (real tide-gauge comparison) — all served from precomputed JSON, no network upstream at request time.
export const getValidationSummary = () => api.get('/validation/summary').then((r) => r.data);
export const getValidationStations = () => api.get('/validation/stations').then((r) => r.data);
export const getValidationStation = (id, days = 30) => api.get(`/validation/station/${id}`, { params: { days } }).then((r) => r.data);
export const getTideTiming = () => api.get('/validation/tide-timing').then((r) => r.data);
export const getValidationEvents = () => api.get('/validation/events').then((r) => r.data);
export const getValidationEvent = (id) => api.get(`/validation/event/${encodeURIComponent(id)}`).then((r) => r.data);

// Active learning: where to survey next (GeoJSON FeatureCollection of Points)
export const getSurveyPriority = (n = 200, bbox) => api.get('/ml/survey-priority', { params: { n, ...(bbox ? { bbox: bbox.join(',') } : {}) } }).then((r) => r.data);
