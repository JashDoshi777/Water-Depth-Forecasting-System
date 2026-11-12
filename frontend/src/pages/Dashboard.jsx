import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Search, X, Layers } from 'lucide-react';
import { spring } from '../components/ui';
import { TYPE_COLOR, fmtCompact } from '../lib/format';
import {
  getLocationsGeoJSON, getLocationStats, searchLocations,
  getCurrentDepth, getWeather, getTide, encodeDIGIPIN,
} from '../services/api';
import { getWaterbodiesGeoJSON, getCycloneSummary, getSurveyPriority } from '../services/api_map';
import {
  BASE_STYLE, addDataLayers, addRealWaterbodies, applyBasemap, applyDataTheme, applyFilter,
  setSurveyData, setSurveyVisible, CLICK_LAYERS, REAL_CLICK_LAYERS, rampCss, IOS_EASE,
} from '../lib/mapStyle';
import PlaceSheet from '../components/map/PlaceSheet';
import LayersSheet, { WB_LAYERS } from '../components/map/LayersSheet';
import ForecastScrubber from '../components/map/ForecastScrubber';
import CycloneLayer from '../components/map/CycloneLayer';
import './Dashboard.css';

const INDIA = [79.0, 22.4];
const BOUNDS = [[38, -12], [130, 48]]; // = wide bathymetry extent (free zoom-out, no visible image edge)

async function fetchRivers() {
  const r = await fetch('/api/v1/map/rivers');
  if (!r.ok) throw new Error('rivers');
  return r.json();
}

function useMedia(q) {
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q); const h = () => setM(mq.matches);
    mq.addEventListener('change', h); h();
    return () => mq.removeEventListener('change', h);
  }, [q]);
  return m;
}

export default function Dashboard({ scheme: themeScheme = 'light' }) {
  const navigate = useNavigate();
  const mobile = useMedia('(max-width: 760px)');
  const wrapRef = useRef(null);
  const [parentH, setParentH] = useState(700);
  const [mapStyle, setMapStyle] = useState('auto');
  const scheme = mapStyle === 'auto' ? themeScheme : mapStyle;
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const reqRef = useRef(0);
  const schemeRef = useRef(scheme);
  schemeRef.current = scheme;
  const filterRef = useRef('all');

  const [mapReady, setMapReady] = useState(false);
  const [points, setPoints] = useState(null);
  const [rivers, setRivers] = useState(null);
  const [real, setReal] = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [forecast, setForecast] = useState('off');
  const [cyclones, setCyclones] = useState(false);
  const [survey, setSurvey] = useState(false);
  const [avail, setAvail] = useState({ forecast: true, cyclones: true, survey: true });
  const [detentH, setDetentH] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [stats, setStats] = useState(null);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [selected, setSelected] = useState(null);
  const [state, setState] = useState('idle');
  const [data, setData] = useState(null);

  // ── data ──
  const load = useCallback(async () => {
    setLoading(true); setFailed(false);
    getWaterbodiesGeoJSON('all').then(setReal).catch(() => {}); // optional, non-blocking
    const [g, r, s] = await Promise.allSettled([getLocationsGeoJSON(), fetchRivers(), getLocationStats()]);
    if (g.status === 'fulfilled') {
      setPoints(g.value);
      if (r.status === 'fulfilled') setRivers(r.value);
      if (s.status === 'fulfilled') setStats(s.value);
    } else setFailed(true);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // probe the optional overlay endpoints once so the sheet can disable what's missing
  useEffect(() => {
    getCycloneSummary().catch(() => setAvail((a) => ({ ...a, cyclones: false })));
    getSurveyPriority(1).catch(() => setAvail((a) => ({ ...a, survey: false })));
  }, []);

  useEffect(() => {
    const el = wrapRef.current; if (!el) return undefined;
    const ro = new ResizeObserver(() => setParentH(el.clientHeight));
    ro.observe(el); setParentH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  // ── fetch details for selected ──
  const fetchDetails = useCallback(async (loc) => {
    const id = ++reqRef.current;
    setState('loading'); setData(null);
    const p = { digipin: loc.digipin };
    const [depth, weather, tide] = await Promise.allSettled([getCurrentDepth(p), getWeather(p), getTide(p)]);
    if (id !== reqRef.current) return;
    const d = {
      depth: depth.status === 'fulfilled' ? depth.value : null,
      weather: weather.status === 'fulfilled' ? weather.value : null,
      tide: tide.status === 'fulfilled' ? tide.value : null,
    };
    setData(d);
    setState(d.depth || d.weather ? 'ready' : 'error');
  }, []);

  const select = useCallback(async (raw) => {
    const map = mapRef.current;
    let loc = { ...raw };
    setSelected(loc); setResults(null); setQuery('');
    setState('loading'); setData(null);
    const wide = window.innerWidth > 760;
    if (map) {
      map.easeTo({
        center: [loc.lon, loc.lat],
        zoom: Math.max(map.getZoom(), loc.type === 'ocean' ? 7 : 9),
        padding: wide ? { right: 380, top: 0, left: 0, bottom: 0 } : { bottom: Math.round((wrapRef.current?.clientHeight || 700) * 0.5), top: 0, left: 0, right: 0 },
        duration: 1400, easing: IOS_EASE, essential: true,
      });
    }
    if (!loc.digipin) {
      try {
        const e = await encodeDIGIPIN(loc.lat, loc.lon);
        loc = { ...loc, digipin: e.digipin };
        setSelected(loc);
      } catch { setState('error'); return; }
    }
    fetchDetails(loc);
  }, [fetchDetails]);

  const close = useCallback(() => {
    reqRef.current++;
    setSelected(null); setState('idle'); setData(null);
    mapRef.current?.easeTo({ padding: { top: 0, right: 0, bottom: 0, left: 0 }, duration: 600, easing: IOS_EASE });
  }, []);

  // ── map init ──
  const selectRef = useRef(select);
  selectRef.current = select;
  useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current, style: BASE_STYLE,
      center: INDIA, zoom: 4.6, minZoom: 3, maxZoom: 16,
      maxBounds: BOUNDS, attributionControl: false, fadeDuration: 150,
      dragRotate: false, pitchWithRotate: false,
    });
    mapRef.current = map;
    if (import.meta.env.DEV) window.__aquaMap = map; // test hook
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

    map.on('load', () => {
      applyBasemap(map, schemeRef.current);
      setMapReady(true);
    });

    const el = document.createElement('div');
    el.className = 'sel-marker'; el.innerHTML = '<i></i>';
    markerRef.current = new maplibregl.Marker({ element: el });

    map.on('click', (e) => {
      const feats = map.queryRenderedFeatures(
        [[e.point.x - 6, e.point.y - 6], [e.point.x + 6, e.point.y + 6]],
        { layers: [...CLICK_LAYERS, 'wb-rivers'].filter((l) => map.getLayer(l)) },
      );
      if (!feats.length) return;
      const f = feats.find((x) => REAL_CLICK_LAYERS.includes(x.layer.id)) || feats.find((x) => x.layer.id !== 'wb-bathy-dots') || feats[0];
      const p = f.properties;
      if (REAL_CLICK_LAYERS.includes(f.layer.id)) {
        selectRef.current({ name: p.name, region: p.state, type: p.kind, lat: Number(p.lat), lon: Number(p.lon), digipin: p.digipin || undefined });
      } else if (f.layer.id === 'wb-rivers') {
        selectRef.current({ name: p.name || 'River', region: 'River', type: 'river', lat: e.lngLat.lat, lon: e.lngLat.lng });
      } else {
        const [lon, lat] = f.geometry.coordinates;
        selectRef.current({ name: p.n, region: p.r, type: p.t, lat, lon, base: p.d });
      }
    });
    const hover = (on) => () => { map.getCanvas().style.cursor = on ? 'pointer' : ''; };
    ['wb-bathy-dots', 'wb-lakes', 'wb-reservoirs', 'wb-rivers', ...REAL_CLICK_LAYERS].forEach((l) => {
      map.on('mouseenter', l, hover(true)); map.on('mouseleave', l, hover(false));
    });

    return () => { markerRef.current?.remove(); map.remove(); mapRef.current = null; };
  }, []);

  // data layers
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !points) return;
    addDataLayers(map, schemeRef.current, points, rivers);
    if (real) addRealWaterbodies(map, schemeRef.current, real);
    applyDataTheme(map, schemeRef.current);
    applyFilter(map, filterRef.current);
  }, [mapReady, points, rivers, real]);

  // survey priority (active learning) rings
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return undefined;
    if (!survey) { setSurveyVisible(map, false); return undefined; }
    let live = true;
    getSurveyPriority(200).then((fc) => { if (live) { setSurveyData(map, schemeRef.current, fc); setSurveyVisible(map, true); } })
      .catch(() => { if (live) { setAvail((a) => ({ ...a, survey: false })); setSurvey(false); } });
    return () => { live = false; };
  }, [mapReady, survey]);

  // theme
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    applyBasemap(map, scheme);
    applyDataTheme(map, scheme);
  }, [mapReady, scheme]);

  // filter
  useEffect(() => {
    filterRef.current = filter;
    const map = mapRef.current;
    if (mapReady && map) applyFilter(map, filter);
  }, [mapReady, filter]);

  // marker
  useEffect(() => {
    const m = markerRef.current, map = mapRef.current;
    if (!m || !map) return;
    if (selected) m.setLngLat([selected.lon, selected.lat]).addTo(map); else m.remove();
  }, [selected?.lat, selected?.lon, !!selected, mapReady]); // eslint-disable-line

  // ESC
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') { if (query || results) { setQuery(''); setResults(null); } else if (selected) close(); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [query, results, selected, close]);

  // search (debounced)
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults(null); return undefined; }
    let live = true;
    const t = setTimeout(async () => {
      try {
        const r = await searchLocations(q);
        if (!live) return;
        const seen = new Set();
        const uniq = (r.locations || []).filter((l) => {
          const k = `${l.name}|${l.region}|${l.water_body_type}`;
          if (seen.has(k)) return false;
          seen.add(k); return true;
        });
        setResults(uniq.slice(0, 8));
      } catch { if (live) setResults([]); }
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [query]);

  const pick = (r) => select({
    name: r.name, region: r.region, type: r.water_body_type,
    lat: r.latitude, lon: r.longitude, digipin: r.digipin,
  });

  const by = stats?.by_type || {};
  const statItems = stats ? [
    ['Total', stats.total ?? stats.total_locations], ['Ocean', by.ocean], ['Rivers', by.river],
    ['Lakes', by.lake], ['Reservoirs', by.reservoir],
  ] : [];

  return (
    <div className={`map-wrap ${forecast !== 'off' ? 'fc-on' : ''} ${cyclones ? 'cy-on' : ''}`} ref={wrapRef}>
      <div ref={containerRef} className="map-canvas" data-testid="map-canvas" />

      <div className={`map-top ${selected && !mobile ? 'with-panel' : ''}`}>
        <div className="map-search material">
          <label className="search">
            <Search />
            <input
              value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Search places, rivers, lakes…" aria-label="Search water bodies"
              onKeyDown={(e) => { if (e.key === 'Enter' && results?.[0]) pick(results[0]); }}
            />
            {query && <button className="clear" aria-label="Clear search" onClick={(e) => { e.preventDefault(); setQuery(''); setResults(null); }}><X /></button>}
          </label>
          <AnimatePresence initial={false}>
            {results && (
              <motion.div className="map-results" role="listbox" aria-label="Search results"
                initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                transition={spring} style={{ overflow: 'hidden auto' }}>
                {results.length === 0 && <div className="map-empty">No matches</div>}
                {results.map((r) => (
                  <button key={r.digipin + r.name} className="map-result" role="option" onClick={() => pick(r)}>
                    <span className="dot" style={{ background: TYPE_COLOR[r.water_body_type] }} />
                    <span className="mr-main">
                      <div className="mr-name">{r.name}</div>
                      <div className="mr-sub">{[r.region, r.water_body_type].filter(Boolean).join(' · ')}</div>
                    </span>
                    {r.distance_km != null && <span className="mr-dist">{Math.round(r.distance_km)} km</span>}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <button className={`layers-btn material ${sheetOpen ? 'on' : ''}`} aria-label="Layers" aria-haspopup="dialog" aria-expanded={sheetOpen}
          onClick={() => setSheetOpen((o) => !o)}><Layers /></button>
      </div>

      <AnimatePresence>
        {sheetOpen && (
          <LayersSheet filter={filter} setFilter={setFilter} forecast={forecast} setForecast={setForecast}
            cyclones={cyclones} setCyclones={setCyclones} survey={survey} setSurvey={setSurvey}
            mapStyle={mapStyle} setMapStyle={setMapStyle} avail={avail} onClose={() => setSheetOpen(false)} />
        )}
      </AnimatePresence>

      {!sheetOpen && !(selected && !mobile) && <div className="map-layers material" role="group" aria-label="Map layers">
        {WB_LAYERS.map((l) => (
          <button key={l.key} className={filter === l.key ? 'active' : ''} aria-pressed={filter === l.key}
            aria-label={`Show ${l.label}`} onClick={() => setFilter(l.key)}>
            <span className={`swatch ${l.key === 'all' ? 'all' : ''}`} style={l.color ? { background: l.color } : undefined} />
            {l.label}
          </button>
        ))}
      </div>}

      {stats && (
        <div className="map-stats material" aria-label="Water body statistics">
          {statItems.map(([k, v]) => <div key={k}><b>{fmtCompact(v ?? 0)}</b><span>{k}</span></div>)}
        </div>
      )}

      {(filter === 'all' || filter === 'ocean') && !selected && (
        <div className="map-legend material" aria-label="Ocean depth legend">
          <div className="lg-title">Ocean depth</div>
          <div className="ramp" style={{ background: rampCss(scheme) }} />
          <div className="lg-row"><span>Shallow</span><span>2,400 m</span></div>
        </div>
      )}

      {mapReady && <CycloneLayer map={mapRef.current} ready={mapReady} scheme={scheme} active={cyclones} hidden={!!selected}
        onUnavailable={() => setAvail((a) => ({ ...a, cyclones: false }))} />}

      {mapReady && forecast !== 'off' && (
        <div className="map-bottom" style={selected ? { display: 'none' } : undefined}>
          <ForecastScrubber map={mapRef.current} ready={mapReady} variable={forecast} onVariable={setForecast} />
        </div>
      )}

      <AnimatePresence>
        {selected && (
          <PlaceSheet key="panel" loc={selected} state={state} data={data} onClose={close} mobile={mobile} parentH={parentH}
            onRetry={() => fetchDetails(selected)} onOpen={() => navigate(`/location/${selected.digipin}`)} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {(loading || failed) && (
          <motion.div className="map-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
            {loading ? (
              <div className="map-pill material" role="status"><div className="spinner" />Loading water bodies…</div>
            ) : (
              <div className="map-pill err material" role="alert">
                <b>Couldn’t load water bodies</b>
                <span style={{ color: 'var(--label-2)', fontSize: 13 }}>Check your connection and try again.</span>
                <button className="btn tinted" onClick={load}>Retry</button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
