// Map styling helpers — recolours the CARTO vector basemap into an Apple-Maps-like
// palette at runtime (one base style, recoloured in place: no reload, no flicker),
// and owns the AquaDepth data layers (bathymetry, rivers, lakes, reservoirs).

export const BASE_STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

export const PALETTE = {
  light: {
    land: '#f5f3ee', water: '#aad3ff', park: '#e4ebd6', built: '#efece4', building: '#eae6dc',
    roadFill: '#ffffff', roadCase: '#e3ded2', rail: '#d6d1c4',
    border: '#bdb7a9', borderSoft: '#d6d1c4',
    text: '#4a4a4f', textSoft: '#7c7c82', waterText: '#5b8fc7', halo: '#f5f3ee',
    ring: '#ffffff',
    river: '#6aa9e6', riverCase: 'rgba(255,255,255,0.55)', stateLine: 'rgba(60,60,67,0.38)', stateText: 'rgba(60,60,67,0.55)',
    lake: '#34c759', reservoir: '#af52de',
    ramp: [[0, '#c4e0fc'], [200, '#92bff0'], [1000, '#76a6e2'], [3000, '#5c8cce'], [6000, '#4674ba']],
  },
  dark: {
    land: '#1c1c1e', water: '#0b2239', park: '#202421', built: '#212123', building: '#242426',
    roadFill: '#2c2c2f', roadCase: '#1c1c1e', rail: '#2c2c2f',
    border: '#58585e', borderSoft: '#3a3a3e',
    text: '#c7c7cc', textSoft: '#8e8e93', waterText: '#5f87b0', halo: '#1c1c1e',
    ring: '#1c1c1e',
    river: '#3f7fb5', riverCase: 'rgba(11,34,57,0.6)', stateLine: 'rgba(235,235,245,0.26)', stateText: 'rgba(235,235,245,0.42)',
    lake: '#30d158', reservoir: '#bf5af2',
    ramp: [[0, '#163e60'], [200, '#0f2c4a'], [1000, '#0c243e'], [3000, '#091c32'], [6000, '#061426']],
  },
};

const safe = (fn) => { try { fn(); } catch { /* layer/property absent in this style version */ } };

/** Recolour the CARTO basemap in place. */
export function applyBasemap(map, scheme) {
  const P = PALETTE[scheme] || PALETTE.light;
  const layers = map.getStyle()?.layers || [];
  const paint = (id, prop, val) => safe(() => map.setPaintProperty(id, prop, val));
  const hide = (id) => safe(() => map.setLayoutProperty(id, 'visibility', 'none'));

  for (const l of layers) {
    const id = l.id;
    if (/^(wb|cy|sv|fc)-/.test(id)) continue; // our own layers
    if (l.type === 'background') { paint(id, 'background-color', P.land); continue; }

    if (id === 'water') { paint(id, 'fill-color', P.water); continue; }
    if (id === 'water_shadow') { hide(id); continue; }
    if (id === 'waterway') { paint(id, 'line-color', P.water); continue; }

    if (id.startsWith('park_') || id === 'landcover') { paint(id, 'fill-color', P.park); paint(id, 'fill-opacity', 0.85); continue; }
    if (id === 'landuse' || id === 'landuse_residential') { paint(id, 'fill-color', P.built); paint(id, 'fill-opacity', 0.7); continue; }
    if (id === 'road_path_areas') { hide(id); continue; }

    if (id.startsWith('building')) { paint(id, 'fill-color', P.building); paint(id, 'fill-opacity', 0.8); continue; }

    if (id.startsWith('boundary_country')) { paint(id, 'line-color', P.border); paint(id, 'line-width', 0.8); continue; }
    if (id.startsWith('boundary_')) { paint(id, 'line-color', P.borderSoft); paint(id, 'line-width', 0.6); continue; }

    if (/^(tunnel|road|bridge)_/.test(id) || id.startsWith('aeroway')) {
      if (l.type !== 'line') continue;
      if (id.includes('_case')) paint(id, 'line-color', P.roadCase);
      else paint(id, 'line-color', P.roadFill);
      continue;
    }
    if (id.startsWith('rail') || id.includes('_rail')) { paint(id, 'line-color', P.rail); continue; }

    if (l.type === 'symbol') {
      if (id.startsWith('poi_') || id === 'housenumber' || id.startsWith('watername_lake_pois') || id === 'roadname_minor') { hide(id); continue; }
      const water = id.startsWith('watername') || id === 'waterway_label';
      paint(id, 'text-color', water ? P.waterText : (id.startsWith('place_country') || id === 'place_state' ? P.textSoft : P.text));
      paint(id, 'text-halo-color', water ? P.water : P.halo);
      paint(id, 'text-halo-width', 1.2);
      paint(id, 'text-halo-blur', 0.4);
    }
  }
}

const rampExpr = (stops) => [
  'interpolate', ['linear'], ['coalesce', ['get', 'd'], 0],
  ...stops.flat(),
];

const firstSymbol = (map) => (map.getStyle()?.layers || []).find((l) => l.type === 'symbol')?.id;

export const BATHY = {
  wide: [[38, 48], [130, 48], [130, -12], [38, -12]],
  india: [[66, 36], [98, 36], [98, 5], [66, 5]],
};
export const bathyUrl = (scheme, region) => `/api/v1/bathymetry/overlay.png?scheme=${scheme === 'dark' ? 'dark' : 'light'}&region=${region}`;

export const DATA_LAYERS = {
  ocean: ['wb-bathy-raster-wide', 'wb-bathy-raster-india', 'wb-bathy-dots'],
  river: ['wb-rivers'],
  lake: ['wb-lakes', 'wb-rl-fill-lake', 'wb-rl-line-lake', 'wb-rl-pin-lake', 'wb-rl-label-lake'],
  reservoir: ['wb-reservoirs', 'wb-rl-fill-reservoir', 'wb-rl-line-reservoir', 'wb-rl-pin-reservoir', 'wb-rl-label-reservoir'],
};
export const REAL_CLICK_LAYERS = ['wb-rl-pin-lake', 'wb-rl-pin-reservoir', 'wb-rl-fill-lake', 'wb-rl-fill-reservoir'];
export const CLICK_LAYERS = ['wb-bathy-dots', 'wb-lakes', 'wb-reservoirs', ...REAL_CLICK_LAYERS];

/** Add (or refresh) sources + data layers. Safe to call repeatedly. */
export function addDataLayers(map, scheme, points, rivers) {
  const P = PALETTE[scheme] || PALETTE.light;
  if (points) {
    if (map.getSource('wb')) map.getSource('wb').setData(points);
    else map.addSource('wb', { type: 'geojson', data: points });
  }
  if (rivers) {
    if (map.getSource('wb-rivers')) map.getSource('wb-rivers').setData(rivers);
    else map.addSource('wb-rivers', { type: 'geojson', data: rivers, lineMetrics: false });
  }
  if (!map.getSource('wb') || map.getLayer('wb-lakes')) return;
  const before = firstSymbol(map);
  const add = (l) => map.addLayer(l, before);
  const ocean = ['==', ['get', 't'], 'ocean'];

  // Smooth bathymetry shading — pre-rendered from real NOAA ETOPO data (see backend /bathymetry).
  // A coarse wide-area image keeps zoomed-out views clean; a detailed India image sits on top.
  for (const region of ['wide', 'india']) {
    if (!map.getSource(`wb-bathy-${region}`)) {
      map.addSource(`wb-bathy-${region}`, { type: 'image', url: bathyUrl(scheme, region), coordinates: BATHY[region] });
    }
    add({
      id: `wb-bathy-raster-${region}`, type: 'raster', source: `wb-bathy-${region}`,
      paint: { 'raster-resampling': 'linear', 'raster-opacity': 1, 'raster-fade-duration': 300 },
    });
  }
  map.__bathyScheme = scheme;

  // State / UT borders + names (Natural Earth admin-1)
  if (!map.getSource('wb-states')) map.addSource('wb-states', { type: 'geojson', data: '/api/v1/map/states' });
  if (!map.getSource('wb-state-labels')) map.addSource('wb-state-labels', { type: 'geojson', data: '/api/v1/map/state-labels' });
  add({
    id: 'wb-states-line', type: 'line', source: 'wb-states', minzoom: 3.6,
    layout: { 'line-join': 'round' },
    paint: {
      'line-color': P.stateLine,
      'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.5, 8, 1],
      'line-dasharray': [4, 3],
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 3.6, 0, 4.6, 1],
    },
  });
  const textFont = (map.getStyle()?.layers || []).find((l) => l.type === 'symbol' && l.layout?.['text-font'])?.layout['text-font'];
  add({
    id: 'wb-state-labels', type: 'symbol', source: 'wb-state-labels', minzoom: 4.4,
    layout: {
      'text-field': ['upcase', ['get', 'name']],
      ...(textFont ? { 'text-font': textFont } : {}),
      'text-size': ['interpolate', ['linear'], ['zoom'], 4.4, 8.5, 7, 11, 10, 14],
      'text-letter-spacing': 0.12, 'text-max-width': 7, 'text-padding': 6,
    },
    paint: { 'text-color': P.stateText, 'text-halo-color': P.halo, 'text-halo-width': 1.2, 'text-opacity': ['interpolate', ['linear'], ['zoom'], 4.4, 0, 5.2, 0.9] },
  });
  // Invisible hit target so ocean points remain clickable
  add({
    id: 'wb-bathy-dots', type: 'circle', source: 'wb', filter: ocean,
    paint: { 'circle-color': '#000', 'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 5, 8, 9, 12, 14], 'circle-opacity': 0 },
  });

  if (map.getSource('wb-rivers')) {
    add({
      id: 'wb-rivers', type: 'line', source: 'wb-rivers', minzoom: 4,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': P.river,
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, ['case', ['<=', ['coalesce', ['get', 'rank'], 9], 4], 0.9, 0.4], 8, ['case', ['<=', ['coalesce', ['get', 'rank'], 9], 4], 1.8, 1], 12, 3],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 4, 0, 5, 0.85],
      },
    });
  }

  const pin = (id, t, color) => add({
    id, type: 'circle', source: 'wb', filter: ['==', ['get', 't'], t],
    paint: {
      'circle-color': color,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 2.6, 5, 3.6, 8, 5.2, 12, 8],
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 3, 1, 8, 1.6],
      'circle-stroke-color': P.ring,
      'circle-pitch-alignment': 'map',
    },
  });
  pin('wb-lakes', 'lake', P.lake);
  pin('wb-reservoirs', 'reservoir', P.reservoir);
  // Names appear once there is room (Apple-style: small, quiet, haloed)
  add({
    id: 'wb-pin-labels', type: 'symbol', source: 'wb', minzoom: 6,
    filter: ['in', ['get', 't'], ['literal', ['lake', 'reservoir']]],
    layout: {
      'text-field': ['get', 'n'],
      ...(textFont ? { 'text-font': textFont } : {}),
      'text-size': ['interpolate', ['linear'], ['zoom'], 6, 10, 10, 12.5],
      'text-offset': [0, 0.9], 'text-anchor': 'top', 'text-max-width': 8, 'text-padding': 4, 'text-optional': true,
    },
    paint: { 'text-color': P.text, 'text-halo-color': P.halo, 'text-halo-width': 1.3, 'text-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0, 6.6, 1] },
  });
}

/** Re-colour our data layers for a scheme (no re-adding). */
export function applyDataTheme(map, scheme) {
  const P = PALETTE[scheme] || PALETTE.light;
  const p = (id, prop, v) => map.getLayer(id) && safe(() => map.setPaintProperty(id, prop, v));
  if (map.__bathyScheme !== scheme) {
    map.__bathyScheme = scheme;
    for (const region of ['wide', 'india']) {
      const img = map.getSource(`wb-bathy-${region}`);
      // swapping the image aborts any in-flight load — that rejection is expected
      if (img?.updateImage) safe(() => Promise.resolve(img.updateImage({ url: bathyUrl(scheme, region), coordinates: BATHY[region] })).catch(() => {}));
    }
  }
  p('wb-rivers', 'line-color', P.river);
  p('wb-states-line', 'line-color', P.stateLine);
  p('wb-state-labels', 'text-color', P.stateText);
  p('wb-state-labels', 'text-halo-color', P.halo);
  p('wb-pin-labels', 'text-color', P.text);
  p('wb-pin-labels', 'text-halo-color', P.halo);
  p('wb-lakes', 'circle-color', P.lake);
  p('wb-lakes', 'circle-stroke-color', P.ring);
  p('wb-reservoirs', 'circle-color', P.reservoir);
  p('wb-reservoirs', 'circle-stroke-color', P.ring);
  for (const k of ['lake', 'reservoir']) {
    p(`wb-rl-fill-${k}`, 'fill-color', P[k]);
    p(`wb-rl-line-${k}`, 'line-color', P[k]);
    p(`wb-rl-pin-${k}`, 'circle-color', P[k]);
    p(`wb-rl-pin-${k}`, 'circle-stroke-color', P.ring);
    p(`wb-rl-label-${k}`, 'text-color', P.text);
    p(`wb-rl-label-${k}`, 'text-halo-color', P.halo);
  }
  p('cy-halo', 'line-color', P.halo);
  p('cy-label', 'text-color', P.text);
  p('cy-label', 'text-halo-color', P.halo);
  p('sv-rings', 'circle-stroke-color', SURVEY_COLOR[scheme] || SURVEY_COLOR.light);
}

/** Show only the chosen water-body group (or all). */
export function applyFilter(map, key) {
  for (const [k, ids] of Object.entries(DATA_LAYERS)) {
    for (const id of ids) {
      const legacy = id === 'wb-lakes' || id === 'wb-reservoirs';
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', (key === 'all' || key === k) && !(legacy && map.__realWB) ? 'visible' : 'none');
    }
  }
  if (map.getLayer('wb-pin-labels') && map.__realWB) map.setLayoutProperty('wb-pin-labels', 'visibility', 'none');
  else if (map.getLayer('wb-pin-labels')) {
    const types = key === 'lake' ? ['lake'] : key === 'reservoir' ? ['reservoir'] : key === 'all' ? ['lake', 'reservoir'] : [];
    map.setFilter('wb-pin-labels', ['in', ['get', 't'], ['literal', types]]);
  }
}

export const rampCss = (scheme) => {
  const s = (PALETTE[scheme] || PALETTE.light).ramp;
  return `linear-gradient(90deg, ${s.map(([d, c], i) => `${c} ${Math.round((i / (s.length - 1)) * 100)}%`).join(', ')})`;
};

export const IOS_EASE = (t) => 1 - Math.pow(1 - t, 4); // easeOutQuart, close to iOS decel


// ───────────── Real water-body outlines (polygons + pins + labels) ─────────────
const textFontOf = (map) => (map.getStyle()?.layers || []).find((l) => l.type === 'symbol' && l.layout?.['text-font'])?.layout['text-font'];

export function addRealWaterbodies(map, scheme, fc) {
  const P = PALETTE[scheme] || PALETTE.light;
  const pts = {
    type: 'FeatureCollection',
    features: fc.features.filter((f) => f.properties && f.properties.lat != null).map((f) => ({
      type: 'Feature', properties: f.properties, geometry: { type: 'Point', coordinates: [f.properties.lon, f.properties.lat] },
    })),
  };
  if (map.getSource('wb-real')) { map.getSource('wb-real').setData(fc); map.getSource('wb-real-pts').setData(pts); }
  else { map.addSource('wb-real', { type: 'geojson', data: fc }); map.addSource('wb-real-pts', { type: 'geojson', data: pts }); }
  map.__realWB = true;
  if (map.getLayer('wb-rl-fill-lake')) return;
  const before = map.getLayer('wb-states-line') ? 'wb-states-line' : firstSymbol(map);
  const font = textFontOf(map);
  const poly = ['any', ['==', ['geometry-type'], 'Polygon'], ['==', ['geometry-type'], 'MultiPolygon']];
  for (const k of ['lake', 'reservoir']) {
    const kind = ['==', ['get', 'kind'], k];
    map.addLayer({ id: `wb-rl-fill-${k}`, type: 'fill', source: 'wb-real', filter: ['all', poly, kind],
      paint: { 'fill-color': P[k], 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 4, 0.45, 9, 0.3] } }, before);
    map.addLayer({ id: `wb-rl-line-${k}`, type: 'line', source: 'wb-real', filter: ['all', poly, kind],
      paint: { 'line-color': P[k], 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.6, 10, 1.4], 'line-opacity': 0.85 } }, before);
    // Size-tiered pins: only large bodies at low zoom, smaller ones fade in as you zoom (no dot cloud)
    const A = ['coalesce', ['get', 'area_km2'], 0];
    const gate = (min, v) => ['case', ['>=', A, min], v, 0];
    map.addLayer({ id: `wb-rl-pin-${k}`, type: 'circle', source: 'wb-real-pts', filter: kind,
      paint: {
        'circle-color': P[k], 'circle-stroke-color': P.ring,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, gate(120, 2.4), 5, gate(20, 3.2), 7, gate(2, 4), 8.5, 4.8, 12, 7],
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 3, gate(120, 0.9), 5, gate(20, 1.1), 7, gate(2, 1.3), 8.5, 1.5],
        'circle-opacity': ['interpolate', ['linear'], ['zoom'], 8, 1, 11, ['case', ['to-boolean', ['get', 'has_outline']], 0, 1]],
        'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'], 8, 1, 11, ['case', ['to-boolean', ['get', 'has_outline']], 0, 1]],
      } }, before);
    map.addLayer({ id: `wb-rl-label-${k}`, type: 'symbol', source: 'wb-real-pts', minzoom: 6, filter: kind,
      layout: {
        'text-field': ['get', 'name'], ...(font ? { 'text-font': font } : {}),
        'text-size': ['interpolate', ['linear'], ['zoom'], 6, 10, 10, 12.5],
        'text-offset': [0, 0.9], 'text-anchor': 'top', 'text-max-width': 8, 'text-padding': 4, 'text-optional': true,
        'symbol-sort-key': ['-', 0, ['coalesce', ['get', 'area_km2'], 0]],
      },
      paint: { 'text-color': P.text, 'text-halo-color': P.halo, 'text-halo-width': 1.3, 'text-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0, 6.6, 1] } });
  }
}

// ───────────── Cyclone tracks (IMD categories, muted sequential scale) ─────────────
export const CYCLONE_CATS = [
  { key: 'D', label: 'Depression', color: '#8fb4c4', w: 1.1 },
  { key: 'DD', label: 'Deep depression', color: '#a3b98a', w: 1.3 },
  { key: 'CS', label: 'Cyclonic storm', color: '#d6b45e', w: 1.6 },
  { key: 'SCS', label: 'Severe', color: '#d9904f', w: 1.9 },
  { key: 'VSCS', label: 'Very severe', color: '#c8645a', w: 2.3 },
  { key: 'ESCS', label: 'Extremely severe', color: '#a24a6e', w: 2.7 },
  { key: 'SuCS', label: 'Super', color: '#733d82', w: 3.1 },
];
const catMatch = (field) => ['match', ['get', 'category'], ...CYCLONE_CATS.flatMap((c) => [c.key, c[field]]), CYCLONE_CATS[0][field]];

export function setCycloneData(map, scheme, fc) {
  const P = PALETTE[scheme] || PALETTE.light;
  if (map.getSource('cy-tracks')) { map.getSource('cy-tracks').setData(fc); return; }
  map.addSource('cy-tracks', { type: 'geojson', data: fc, promoteId: 'sid' });
  const before = map.getLayer('wb-states-line') ? 'wb-states-line' : firstSymbol(map);
  const font = textFontOf(map);
  const zw = (add = 0) => ['interpolate', ['linear'], ['zoom'], 3, ['+', ['*', catMatch('w'), 0.8], add], 8, ['+', ['*', catMatch('w'), 1.6], add]];
  map.addLayer({ id: 'cy-halo', type: 'line', source: 'cy-tracks', layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': P.halo, 'line-opacity': 0.55, 'line-width': zw(1.6) } }, before);
  map.addLayer({ id: 'cy-line', type: 'line', source: 'cy-tracks', layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': catMatch('color'), 'line-width': zw(),
      'line-opacity': ['case', ['boolean', ['feature-state', 'hl'], false], 1, ['boolean', ['feature-state', 'dim'], false], 0.25, 0.72],
    } }, before);
  map.addLayer({ id: 'cy-hit', type: 'line', source: 'cy-tracks', layout: { 'line-cap': 'round' },
    paint: { 'line-color': '#000', 'line-opacity': 0, 'line-width': 14 } }, before);
  map.addLayer({ id: 'cy-hl', type: 'line', source: 'cy-tracks', filter: ['==', ['get', 'sid'], ''], layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': catMatch('color'), 'line-width': zw(1.8) } });
  map.addLayer({ id: 'cy-label', type: 'symbol', source: 'cy-tracks', minzoom: 3.5, filter: ['==', ['get', 'sid'], ''],
    layout: { 'symbol-placement': 'line', 'text-field': ['concat', ['get', 'name'], ' ', ['to-string', ['get', 'year']]],
      ...(font ? { 'text-font': font } : {}), 'text-size': 11, 'text-letter-spacing': 0.04, 'symbol-spacing': 400 },
    paint: { 'text-color': P.text, 'text-halo-color': P.halo, 'text-halo-width': 1.4 } });
}
export const setCycloneLabels = (map, sids) => map.getLayer('cy-label') && map.setFilter('cy-label', ['in', ['get', 'sid'], ['literal', sids.length ? sids : ['']]]);
export const setCycloneHighlight = (map, sid) => map.getLayer('cy-hl') && map.setFilter('cy-hl', ['==', ['get', 'sid'], sid || '']);
export function setCycloneVisible(map, on) {
  for (const id of ['cy-halo', 'cy-line', 'cy-hit', 'cy-hl', 'cy-label']) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
}

// ───────────── Survey-priority rings ─────────────
export const SURVEY_COLOR = { light: '#c77d1e', dark: '#e0a050' };
export function setSurveyData(map, scheme, fc) {
  const us = fc.features.map((f) => f.properties?.uncertainty_m).filter((x) => x != null);
  const lo = Math.min(...us), hi = Math.max(...us, lo + 1e-6); // radius is relative to this batch's range
  const u = ['coalesce', ['get', 'uncertainty_m'], lo];
  const r = (k) => ['interpolate', ['linear'], u, lo, 6 * k, hi, 18 * k];
  const radius = ['interpolate', ['linear'], ['zoom'], 3, r(0.7), 6, r(1), 9, r(1.6)];
  if (map.getSource('sv')) { map.getSource('sv').setData(fc); if (map.getLayer('sv-rings')) map.setPaintProperty('sv-rings', 'circle-radius', radius); return; }
  map.addSource('sv', { type: 'geojson', data: fc });
  const col = SURVEY_COLOR[scheme] || SURVEY_COLOR.light;
  map.addLayer({
    id: 'sv-rings', type: 'circle', source: 'sv',
    paint: {
      'circle-color': col, 'circle-opacity': 0.07, 'circle-radius': radius,
      'circle-stroke-color': col, 'circle-stroke-width': 1.2, 'circle-stroke-opacity': 0.8,
    },
  });
}
export const setSurveyVisible = (map, on) => map.getLayer('sv-rings') && map.setLayoutProperty('sv-rings', 'visibility', on ? 'visible' : 'none');

// ───────────── Forecast field (smooth bilinear canvas → image source) ─────────────
export const FIELD_RAMPS = {
  // [value, r, g, b, alpha]; values in the variable's canonical unit (mm/h-ish, m, m/s)
  rain: [[0.25, 84, 156, 232, 0], [1, 84, 156, 232, 0.32], [3, 58, 124, 218, 0.58], [8, 76, 100, 204, 0.78], [16, 122, 88, 192, 0.9], [35, 156, 78, 170, 1]],
  wave: [[0.2, 190, 228, 216, 0], [0.7, 190, 228, 216, 0.55], [1.5, 110, 194, 196, 0.75], [3, 74, 143, 192, 0.88], [5, 74, 95, 174, 0.95], [7.5, 98, 66, 150, 1]],
  wind: [[1.5, 215, 232, 201, 0], [4, 215, 232, 201, 0.5], [8, 169, 208, 143, 0.75], [12, 226, 210, 122, 0.85], [18, 224, 161, 90, 0.92], [26, 201, 106, 90, 0.96], [36, 142, 74, 122, 1]],
};
export const FIELD_META = {
  rain: { label: 'Rain', unit: 'mm/h' }, wave: { label: 'Waves', unit: 'm' }, wind: { label: 'Wind', unit: 'm/s' },
};
const unitScale = (u = '') => (/km\s*\/?\s*h/i.test(u) ? 3.6 : /kt|knot/i.test(u) ? 1.944 : /mm/.test(u) ? 1 : 1);
export function rampFor(variable, unit) {
  const k = variable === 'wind' ? unitScale(unit) : 1;
  return FIELD_RAMPS[variable].map(([v, r, g, b, a]) => [v * k, r, g, b, a]);
}
export function rampCssFor(variable, unit) {
  const r = rampFor(variable, unit); const max = r[r.length - 2][0];
  return `linear-gradient(90deg, ${r.slice(1).map(([v, R, G, B]) => `rgb(${R},${G},${B}) ${Math.min(100, Math.round((v / max) * 100))}%`).join(', ')})`;
}
function colorAt(ramp, v) {
  if (v <= ramp[0][0]) return [0, 0, 0, 0];
  for (let i = 1; i < ramp.length; i++) {
    if (v <= ramp[i][0]) {
      const a = ramp[i - 1], b = ramp[i], t = (v - a[0]) / (b[0] - a[0]);
      return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t, a[4] + (b[4] - a[4]) * t];
    }
  }
  const l = ramp[ramp.length - 1]; return [l[1], l[2], l[3], l[4]];
}
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (Math.max(-85, Math.min(85, lat)) * Math.PI) / 360));
const invMercY = (y) => ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180) / Math.PI;

const cr = (t) => { // Catmull-Rom weights for 4 taps
  const t2 = t * t, t3 = t2 * t;
  return [(-t3 + 2 * t2 - t) / 2, (3 * t3 - 5 * t2 + 2) / 2, (-3 * t3 + 4 * t2 + t) / 2, (t3 - t2) / 2];
};
/** Render frame `f` (float index, blends neighbours) of a forecast grid into a canvas.
 *  Mercator-correct, bicubic (Catmull-Rom) on the coarse grid → smooth field, bilinear fallback at data edges. */
export function renderField(canvas, grid, f, ramp) {
  const { nx, ny, lats, lons, frames } = grid;
  const i0 = Math.max(0, Math.min(frames.length - 1, Math.floor(f))), i1 = Math.min(frames.length - 1, i0 + 1), tt = f - i0;
  const G = new Float32Array(nx * ny);
  for (let i = 0; i < G.length; i++) {
    const a = frames[i0][i], b = frames[i1][i];
    const av = a == null ? NaN : a, bv = b == null ? NaN : b;
    G[i] = Number.isNaN(av) ? bv : Number.isNaN(bv) ? av : av + (bv - av) * tt;
  }
  const latAsc = lats[0] < lats[ny - 1], lonAsc = lons[0] < lons[nx - 1];
  const latMin = Math.min(lats[0], lats[ny - 1]), latMax = Math.max(lats[0], lats[ny - 1]);
  const lonMin = Math.min(lons[0], lons[nx - 1]), lonMax = Math.max(lons[0], lons[nx - 1]);
  const W = canvas.width, H = canvas.height;
  const yTop = mercY(latMax), yBot = mercY(latMin);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, H); const d = img.data;
  const wxs = new Array(W), x0s = new Int16Array(W), fxs = new Float32Array(W);
  for (let px = 0; px < W; px++) {
    let gx = ((px + 0.5) / W) * (nx - 1); if (!lonAsc) gx = nx - 1 - gx;
    const x0 = Math.max(0, Math.min(nx - 2, Math.floor(gx))); x0s[px] = x0; fxs[px] = Math.max(0, Math.min(1, gx - x0)); wxs[px] = cr(fxs[px]);
  }
  const rows = [0, 0, 0, 0];
  const edgeX = new Float32Array(W);
  for (let px = 0; px < W; px++) { const g = ((px + 0.5) / W) * (nx - 1); edgeX[px] = Math.min(g, nx - 1 - g) / 1.4; }
  for (let py = 0; py < H; py++) {
    const lat = invMercY(yTop + ((yBot - yTop) * (py + 0.5)) / H);
    let gy = ((lat - latMin) / (latMax - latMin)) * (ny - 1); if (!latAsc) gy = ny - 1 - gy;
    gy = Math.max(0, Math.min(ny - 1, gy));
    const edgeY = Math.min(gy, ny - 1 - gy) / 1.4;
    const y0 = Math.max(0, Math.min(ny - 2, Math.floor(gy))), fy = Math.max(0, Math.min(1, gy - y0)), wy = cr(fy);
    for (let px = 0; px < W; px++) {
      const x0 = x0s[px], wx = wxs[px];
      let ok = true, v = 0, cover = 1;
      for (let j = 0; j < 4 && ok; j++) {
        const iy = Math.max(0, Math.min(ny - 1, y0 - 1 + j)); let r = 0;
        for (let i = 0; i < 4; i++) {
          const g = G[iy * nx + Math.max(0, Math.min(nx - 1, x0 - 1 + i))];
          if (g !== g) { ok = false; break; }
          r += g * wx[i];
        }
        rows[j] = r; v += r * wy[j];
      }
      const o = (py * W + px) * 4;
      if (!ok) { // bilinear over the valid corners (needs most of the cell to have data → soft coastline)
        let sum = 0, ws = 0; const fx = fxs[px];
        for (let k = 0; k < 4; k++) {
          const g = G[(y0 + (k >> 1)) * nx + x0 + (k & 1)]; if (g !== g) continue;
          const w = (k & 1 ? fx : 1 - fx) * (k >> 1 ? fy : 1 - fy); sum += g * w; ws += w;
        }
        if (ws < 0.3) { d[o + 3] = 0; continue; }
        v = sum / ws; cover = Math.min(1, Math.max(0, (ws - 0.3) / 0.45)); cover = cover * cover * (3 - 2 * cover);
      }
      if (v < 0) v = 0;
      const c = colorAt(ramp, v);
      const ex = Math.min(1, edgeX[px], edgeY) ; const edge = ex * ex * (3 - 2 * ex);
      d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = Math.round(c[3] * 255 * cover * edge);
    }
  }
  ctx.putImageData(img, 0, 0);
}
export const gridCoords = (b) => [[b.lon_min, b.lat_max], [b.lon_max, b.lat_max], [b.lon_max, b.lat_min], [b.lon_min, b.lat_min]];

export function setForecastImage(map, url, coordinates, opacity = 0.62) {
  const src = map.getSource('fc-field');
  if (src) { src.updateImage({ url, coordinates }); }
  else {
    map.addSource('fc-field', { type: 'image', url, coordinates });
    const before = map.getLayer('wb-states-line') ? 'wb-states-line' : firstSymbol(map);
    map.addLayer({ id: 'fc-field', type: 'raster', source: 'fc-field', paint: { 'raster-resampling': 'linear', 'raster-opacity': opacity, 'raster-fade-duration': 0 } }, before);
  }
  map.setLayoutProperty('fc-field', 'visibility', 'visible');
}
export const hideForecast = (map) => map.getLayer('fc-field') && map.setLayoutProperty('fc-field', 'visibility', 'none');
