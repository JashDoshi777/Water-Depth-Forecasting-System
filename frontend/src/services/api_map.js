import api from './api';

// The dev server falls back to index.html for unknown routes, so an absent endpoint can answer 200 + HTML.
// Everything here therefore validates the shape and throws when the endpoint is not really there.
async function getJSON(url, params, check) {
  const res = await api.get(url, { params });
  const d = res.data;
  if (!d || typeof d !== 'object' || (check && !check(d))) throw new Error(`endpoint unavailable: ${url}`);
  return d;
}
const isFC = (d) => d.type === 'FeatureCollection' && Array.isArray(d.features);

export const getWaterbodiesGeoJSON = (kind = 'all') => getJSON('/waterbodies/geojson', { kind }, isFC);
export const getCycloneTracks = ({ yearFrom, yearTo, minCategory } = {}) =>
  getJSON('/cyclones/tracks', { year_from: yearFrom, year_to: yearTo, min_category: minCategory }, isFC);
export const getCycloneSummary = () => getJSON('/cyclones/summary', {}, (d) => Array.isArray(d.years));
export const getCycloneStorm = (sid) => getJSON(`/cyclones/storm/${encodeURIComponent(sid)}`);
export const getForecastGrid = (variable, hours = 48, step = 3) =>
  getJSON('/forecast-grid', { var: variable, hours, step }, (d) => Array.isArray(d.frames) && Array.isArray(d.times) && d.nx > 1 && d.ny > 1);
export const getSurveyPriority = (n = 200) => getJSON('/ml/survey-priority', { n }, isFC);
