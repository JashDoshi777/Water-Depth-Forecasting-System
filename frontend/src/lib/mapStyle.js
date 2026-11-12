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
    if (id.startsWith('wb-')) continue; // our own layers
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
  lake: ['wb-lakes'],
  reservoir: ['wb-reservoirs'],
};
export const CLICK_LAYERS = ['wb-bathy-dots', 'wb-lakes', 'wb-reservoirs'];

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
}

/** Show only the chosen water-body group (or all). */
export function applyFilter(map, key) {
  for (const [k, ids] of Object.entries(DATA_LAYERS)) {
    for (const id of ids) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', key === 'all' || key === k ? 'visible' : 'none');
    }
  }
  if (map.getLayer('wb-pin-labels')) {
    const types = key === 'lake' ? ['lake'] : key === 'reservoir' ? ['reservoir'] : key === 'all' ? ['lake', 'reservoir'] : [];
    map.setFilter('wb-pin-labels', ['in', ['get', 't'], ['literal', types]]);
  }
}

export const rampCss = (scheme) => {
  const s = (PALETTE[scheme] || PALETTE.light).ramp;
  return `linear-gradient(90deg, ${s.map(([d, c], i) => `${c} ${Math.round((i / (s.length - 1)) * 100)}%`).join(', ')})`;
};

export const IOS_EASE = (t) => 1 - Math.pow(1 - t, 4); // easeOutQuart, close to iOS decel
