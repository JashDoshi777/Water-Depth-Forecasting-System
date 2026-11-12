import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  Search, Droplets, Waves, CloudRain, ChevronRight,
  MapPin, Thermometer, Wind, Gauge, X, Navigation,
  Anchor, Fish, Mountain,
} from 'lucide-react';
import useAppStore from '../stores/appStore';
import {
  getLocationsGeoJSON, getLocationStats,
  searchLocations, getCurrentDepth, getWeather, getTide,
  encodeDIGIPIN,
} from '../services/api';

const INDIA = [79.0, 22.0];
const STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

const TYPE_COLORS = {
  ocean: '#0A84FF',
  river: '#64D2FF',
  lake: '#30D158',
  reservoir: '#BF5AF2',
};

export default function Dashboard() {
  const navigate = useNavigate();
  const mapContainer = useRef(null);
  const mapRef = useRef(null);
  const popupRef = useRef(null);
  const layersAdded = useRef(false);

  const {
    selectedLocation, setSelectedLocation,
    searchQuery, setSearchQuery, searchResults, setSearchResults,
  } = useAppStore();

  const [isLoading, setIsLoading] = useState(true);
  const [selectedData, setSelectedData] = useState(null);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [activeFilter, setActiveFilter] = useState('all');
  const [stats, setStats] = useState({ total: 0, ocean: 0, river: 0, lake: 0, reservoir: 0 });
  const [geojsonData, setGeojsonData] = useState(null);
  const [loadFailed, setLoadFailed] = useState(false);

  // ── Load GeoJSON + stats ──
  useEffect(() => {
    (async () => {
      setIsLoading(true);
      try {
        const [geoRes, statsRes] = await Promise.allSettled([
          getLocationsGeoJSON(),
          getLocationStats(),
        ]);

        if (geoRes.status === 'fulfilled') {
          setGeojsonData(geoRes.value);
        } else {
          setLoadFailed(true);
        }

        if (statsRes.status === 'fulfilled') {
          const s = statsRes.value;
          setStats({
            total: s.total || s.total_locations || 0,
            ocean: s.by_type?.ocean || 0,
            river: s.by_type?.river || 0,
            lake: s.by_type?.lake || 0,
            reservoir: s.by_type?.reservoir || 0,
          });
        }
      } catch (err) {
        console.error('Failed to load map data:', err);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  // ── Init map ──
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: STYLE,
      center: INDIA,
      zoom: 4.8,
      attributionControl: false,
      maxBounds: [[55, -5], [105, 42]],
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    mapRef.current = map;

    // Click handler for circle layers
    const handleLayerClick = async (e) => {
      if (!e.features?.length) return;
      const f = e.features[0];
      const coords = f.geometry.coordinates;
      const props = f.properties;

      // Compute DIGIPIN on click (not stored in GeoJSON for speed)
      let digipin = '';
      try {
        const res = await encodeDIGIPIN(coords[1], coords[0]);
        digipin = res.digipin || '';
      } catch { /* fallback */ }

      const loc = {
        name: props.n,
        region: props.r,
        water_body_type: props.t,
        digipin,
        latitude: coords[1],
        longitude: coords[0],
      };

      handleMarkerClick(loc);
    };

    // Wait for style to load before adding layers
    map.on('load', () => {
      // We add layers in the geojson effect below
    });

    // Layer interaction handlers
    ['ocean-layer', 'river-layer', 'lake-layer', 'reservoir-layer'].forEach((layer) => {
      map.on('click', layer, handleLayerClick);
      map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // ── Add GeoJSON data to map when available ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !geojsonData || layersAdded.current) return;

    const addLayers = () => {
      if (layersAdded.current) return;

      // Add source with ALL locations
      map.addSource('locations', {
        type: 'geojson',
        data: geojsonData,
      });

      // Ocean layer — very subtle, avoid solid fill look
      map.addLayer({
        id: 'ocean-layer',
        type: 'circle',
        source: 'locations',
        filter: ['==', ['get', 't'], 'ocean'],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 0.8, 6, 1.8, 10, 4.5],
          'circle-color': '#0A84FF',
          'circle-opacity': ['interpolate', ['linear'], ['zoom'], 3, 0.35, 6, 0.5, 10, 0.75],
          'circle-stroke-width': 0,
          'circle-stroke-color': 'transparent',
        },
      });

      // River layer — visible flowing lines through India
      map.addLayer({
        id: 'river-layer',
        type: 'circle',
        source: 'locations',
        filter: ['==', ['get', 't'], 'river'],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 0.8, 6, 1.8, 10, 4],
          'circle-color': '#64D2FF',
          'circle-opacity': ['interpolate', ['linear'], ['zoom'], 3, 0.6, 6, 0.75, 10, 0.9],
          'circle-stroke-width': 0,
          'circle-stroke-color': 'transparent',
        },
      });

      // Lake layer — prominent green dots
      map.addLayer({
        id: 'lake-layer',
        type: 'circle',
        source: 'locations',
        filter: ['==', ['get', 't'], 'lake'],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 3, 6, 5, 10, 9],
          'circle-color': '#30D158',
          'circle-opacity': 0.85,
          'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 3, 0, 6, 0.5, 10, 1],
          'circle-stroke-color': 'rgba(48, 209, 88, 0.3)',
        },
      });

      // Reservoir layer — prominent purple dots
      map.addLayer({
        id: 'reservoir-layer',
        type: 'circle',
        source: 'locations',
        filter: ['==', ['get', 't'], 'reservoir'],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 3, 6, 5, 10, 9],
          'circle-color': '#BF5AF2',
          'circle-opacity': 0.85,
          'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 3, 0, 6, 0.5, 10, 1],
          'circle-stroke-color': 'rgba(191, 90, 242, 0.3)',
        },
      });

      layersAdded.current = true;
    };

    if (map.isStyleLoaded()) {
      addLayers();
    } else {
      map.once('load', addLayers);
    }
  }, [geojsonData]);

  // ── Toggle layer visibility based on filter ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !layersAdded.current) return;

    const layers = ['ocean-layer', 'river-layer', 'lake-layer', 'reservoir-layer'];
    const typeMap = { ocean: 'ocean-layer', river: 'river-layer', lake: 'lake-layer', reservoir: 'reservoir-layer' };

    layers.forEach((layer) => {
      try {
        if (activeFilter === 'all') {
          map.setLayoutProperty(layer, 'visibility', 'visible');
        } else {
          map.setLayoutProperty(layer, 'visibility', typeMap[activeFilter] === layer ? 'visible' : 'none');
        }
      } catch (e) { /* layer not yet added */ }
    });
  }, [activeFilter]);

  // ── Handle marker/feature click ──
  const handleMarkerClick = useCallback(async (loc) => {
    setSelectedLocation(loc);
    setIsLoadingData(true);
    setSelectedData(null);

    mapRef.current?.flyTo({
      center: [loc.longitude, loc.latitude],
      zoom: 8,
      duration: 1200,
      essential: true,
    });

    try {
      const [depth, weather, tide] = await Promise.allSettled([
        getCurrentDepth({ digipin: loc.digipin }),
        getWeather({ digipin: loc.digipin }),
        getTide({ digipin: loc.digipin }),
      ]);

      setSelectedData({
        depth: depth.status === 'fulfilled' ? depth.value : null,
        weather: weather.status === 'fulfilled' ? weather.value : null,
        tide: tide.status === 'fulfilled' ? tide.value : null,
      });
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoadingData(false);
    }
  }, []);

  // ── Search ──
  const handleSearch = useCallback(async (q) => {
    setSearchQuery(q);
    if (q.length < 2) { setSearchResults([]); return; }
    try {
      const data = await searchLocations(q);
      setSearchResults(data.locations || []);
    } catch { setSearchResults([]); }
  }, []);

  return (
    <div className="dashboard-layout">
      {/* Map */}
      <div className="map-container" ref={mapContainer} />

      {/* Top — Spotlight command bar */}
      <div className="map-overlay-top">
        <motion.div
          className="command-bar"
          initial={{ opacity: 0, y: -15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.5 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Search size={15} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
            <input
              type="text"
              placeholder="Search DIGIPIN locations, rivers, lakes..."
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              onFocus={() => setShowSearch(true)}
              style={{
                flex: 1, border: 'none', outline: 'none', background: 'transparent',
                color: 'var(--text-primary)', fontFamily: 'var(--font-family)',
                fontSize: 'var(--text-sm)', fontWeight: 400,
              }}
            />
            {searchQuery && (
              <X size={14} style={{ cursor: 'pointer', color: 'var(--text-tertiary)' }}
                onClick={() => { setSearchQuery(''); setSearchResults([]); setShowSearch(false); }}
              />
            )}
          </div>

          <AnimatePresence>
            {showSearch && searchResults.length > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                style={{ overflow: 'hidden', marginTop: '8px', borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '8px' }}
              >
                {searchResults.slice(0, 6).map((loc, i) => (
                  <div
                    key={loc.digipin || i}
                    className="location-card"
                    onClick={() => { handleMarkerClick(loc); setShowSearch(false); }}
                  >
                    <MapPin size={13} style={{ color: TYPE_COLORS[loc.water_body_type], flexShrink: 0 }} />
                    <div className="location-card-info">
                      <div className="location-card-name">{loc.name}</div>
                      <div className="location-card-region">{loc.region} · {loc.water_body_type}</div>
                    </div>
                    <ChevronRight size={12} style={{ color: 'var(--text-quaternary)' }} />
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>

      {/* Left — Filter pills */}
      <motion.div
        className="map-overlay-left"
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.5, duration: 0.4 }}
      >
        <div className="map-filter-pills" style={{ flexDirection: 'column' }}>
          {[
            { key: 'all', label: 'All Types', color: '#fff' },
            { key: 'ocean', label: 'Ocean', color: TYPE_COLORS.ocean },
            { key: 'river', label: 'Rivers', color: TYPE_COLORS.river },
            { key: 'lake', label: 'Lakes', color: TYPE_COLORS.lake },
            { key: 'reservoir', label: 'Reservoirs', color: TYPE_COLORS.reservoir },
          ].map(({ key, label, color }) => (
            <div
              key={key}
              className={`map-filter-pill${activeFilter === key ? ' active' : ''}`}
              onClick={() => setActiveFilter(key)}
            >
              <span className="dot" style={{ background: color }} />
              {label}
            </div>
          ))}
        </div>
      </motion.div>

      {/* Right — Info panel */}
      <AnimatePresence>
        {selectedLocation && (
          <motion.div
            className="map-info-panel"
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 50 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          >
            <div className="glass-card glass-card--elevated" style={{
              marginBottom: '12px',
              background: 'rgba(10,18,32,0.92)',
              backdropFilter: 'blur(50px) saturate(180%)',
            }}>
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
                <div>
                  <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 700, marginBottom: '4px', letterSpacing: '-0.02em' }}>
                    {selectedLocation.name}
                  </h3>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                    <span className={`chip ${selectedLocation.water_body_type}`}>
                      {selectedLocation.water_body_type}
                    </span>
                    <span style={{ fontSize: '10px', color: 'var(--text-quaternary)', fontFamily: 'var(--font-mono)' }}>
                      {selectedLocation.latitude?.toFixed(3)}°N, {selectedLocation.longitude?.toFixed(3)}°E
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedLocation(null)}
                  style={{
                    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)',
                    borderRadius: '8px', width: '28px', height: '28px', display: 'flex',
                    alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                    color: 'var(--text-tertiary)',
                  }}
                >
                  <X size={14} />
                </button>
              </div>

              {isLoadingData ? (
                <div className="loading-state" style={{ padding: '32px' }}>
                  <div className="spinner" />
                  <span style={{ fontSize: '11px' }}>Fetching live data...</span>
                </div>
              ) : selectedData?.depth ? (
                <>
                  {/* Depth hero */}
                  <div style={{
                    textAlign: 'center', marginBottom: '20px',
                    padding: '20px', borderRadius: '16px',
                    background: 'linear-gradient(135deg, rgba(10,132,255,0.06) 0%, rgba(100,210,255,0.03) 100%)',
                    border: '1px solid rgba(100,210,255,0.06)',
                  }}>
                    <div style={{
                      fontSize: '42px', fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1,
                      background: 'var(--gradient-ocean)', WebkitBackgroundClip: 'text',
                      WebkitTextFillColor: 'transparent', backgroundClip: 'text',
                    }}>
                      {selectedData.depth.computed_depth.toFixed(1)}
                      <span style={{ fontSize: '18px', WebkitTextFillColor: 'var(--text-secondary)' }}> m</span>
                    </div>
                    <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600, marginTop: '6px' }}>
                      Current Water Depth
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <MiniStat icon={<Anchor size={13} />} label="Base Depth" value={`${selectedData.depth.base_depth.toFixed(1)}m`} color="var(--accent-blue)" />
                    <MiniStat icon={<Waves size={13} />} label="Tidal" value={`${selectedData.depth.tidal_offset >= 0 ? '+' : ''}${selectedData.depth.tidal_offset.toFixed(2)}m`} color="var(--accent-teal)" />
                    <MiniStat icon={<CloudRain size={13} />} label="Rainfall" value={`+${selectedData.depth.rainfall_impact.toFixed(2)}m`} color="var(--accent-green)" />
                    <MiniStat icon={<Gauge size={13} />} label="Confidence" value={`${(selectedData.depth.confidence * 100).toFixed(0)}%`} color="var(--accent-purple)" />
                  </div>
                </>
              ) : (
                <div className="empty-state" style={{ padding: '20px' }}>
                  <Anchor size={24} />
                  <span style={{ fontSize: '11px' }}>No depth data available</span>
                </div>
              )}
            </div>

            {/* Weather */}
            {selectedData?.weather && (
              <motion.div
                className="glass-card"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
                style={{ marginBottom: '12px', background: 'rgba(10,18,32,0.88)' }}
              >
                <div style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', marginBottom: '10px' }}>Weather</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                  <MiniStat icon={<Thermometer size={12} />} label="Temp" value={`${selectedData.weather.temperature_c?.toFixed(1)}°C`} color="var(--accent-orange)" />
                  <MiniStat icon={<CloudRain size={12} />} label="Rain" value={`${selectedData.weather.precipitation_mm?.toFixed(1)} mm`} color="var(--accent-blue)" />
                  <MiniStat icon={<Wind size={12} />} label="Wind" value={`${selectedData.weather.wind_speed_ms?.toFixed(1)} m/s`} color="var(--text-secondary)" />
                  <MiniStat icon={<Droplets size={12} />} label="Humidity" value={`${selectedData.weather.humidity_pct?.toFixed(0)}%`} color="var(--accent-teal)" />
                </div>
              </motion.div>
            )}

            {/* Full analysis button */}
            <motion.button
              className="btn btn-primary"
              style={{ width: '100%', padding: '13px', fontSize: '13px', borderRadius: '12px' }}
              onClick={() => navigate(`/location/${selectedLocation.digipin}`)}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <Navigation size={14} />
              View Full Analysis
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom stats */}
      <div className="map-stats-bar">
        {[
          { label: 'Total DIGIPIN', value: fmtNum(stats.total), icon: <MapPin size={14} />, color: 'var(--accent-blue)' },
          { label: 'Coastal', value: fmtNum(stats.ocean), icon: <Waves size={14} />, color: '#0A84FF' },
          { label: 'Rivers', value: fmtNum(stats.river), icon: <Droplets size={14} />, color: '#64D2FF' },
          { label: 'Lakes', value: fmtNum(stats.lake), icon: <Fish size={14} />, color: '#30D158' },
          { label: 'Reservoirs', value: fmtNum(stats.reservoir), icon: <Mountain size={14} />, color: '#BF5AF2' },
        ].map(({ label, value, icon, color }, i) => (
          <motion.div
            key={label}
            className="glass-card"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 + i * 0.08 }}
            style={{
              flex: 1, display: 'flex', alignItems: 'center', gap: '10px',
              padding: '10px 16px',
              background: 'rgba(10,18,32,0.85)',
              backdropFilter: 'blur(40px)',
            }}
          >
            <div style={{ color }}>{icon}</div>
            <div>
              <div style={{ fontSize: 'var(--text-lg)', fontWeight: 700, letterSpacing: '-0.02em' }}>{value}</div>
              <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{label}</div>
            </div>
          </motion.div>
        ))}
      </div>

      {loadFailed && !isLoading && (
        <div style={{
          position: 'absolute', top: 76, left: '50%', transform: 'translateX(-50%)', zIndex: 15,
          padding: '10px 16px', borderRadius: 12, fontSize: 12,
          background: 'rgba(255,69,58,0.15)', border: '1px solid rgba(255,69,58,0.4)', color: '#ffb3ad',
        }}>
          Couldn't load locations — is the backend running on port 7860?
        </div>
      )}

      {/* Loading overlay */}
      {isLoading && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', zIndex: 20,
          background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)',
        }}>
          <div className="spinner" style={{ width: '32px', height: '32px', borderWidth: '3px' }} />
          <div style={{ marginTop: '12px', fontSize: '13px', color: 'var(--text-secondary)' }}>
            Loading 95K+ DIGIPIN locations...
          </div>
        </div>
      )}
    </div>
  );
}

function fmtNum(n) {
  if (!n) return '0';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function MiniStat({ icon, label, value, color }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '8px',
      padding: '8px 10px', borderRadius: '10px', background: 'rgba(255,255,255,0.025)',
      border: '1px solid rgba(255,255,255,0.03)',
    }}>
      <div style={{ color, flexShrink: 0, opacity: 0.9 }}>{icon}</div>
      <div>
        <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{label}</div>
        <div style={{ fontSize: '13px', fontWeight: 600, letterSpacing: '-0.01em' }}>{value}</div>
      </div>
    </div>
  );
}
