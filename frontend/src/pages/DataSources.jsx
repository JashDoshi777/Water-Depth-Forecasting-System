import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { getSystemStatus } from '../services/api';
import {
  Database, Globe, Waves, Layers, Compass, Radio,
  CheckCircle2, AlertCircle, Clock, Zap, Server,
  Activity, Cpu, HardDrive, Satellite,
} from 'lucide-react';

const fadeUp = { initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 } };

const DATA_SOURCES = [
  {
    name: 'Open-Meteo Weather',
    key: 'open_meteo_weather',
    description: 'Weather data: temperature, precipitation, wind speed, humidity, pressure. Provides real-time and historical meteorological data from ERA5 reanalysis.',
    icon: Globe,
    color: 'var(--accent-green)',
    bg: 'var(--accent-green-dim)',
    features: ['Temperature (°C)', 'Precipitation (mm/h)', 'Wind Speed (m/s)', 'Humidity (%)', 'Pressure (hPa)', '72h Rolling Rainfall'],
    resolution: '0.25° grid (~25km)',
    update: 'Hourly',
    type: 'Weather',
  },
  {
    name: 'StormGlass Marine',
    key: 'stormglass',
    description: 'Ocean tide and marine data: sea level, tide phase, wave height, wave period. Uses multiple maritime forecast models.',
    icon: Waves,
    color: 'var(--accent-blue)',
    bg: 'var(--accent-blue-dim)',
    features: ['Sea Level (m)', 'Tide Phase', 'Wave Height (m)', 'Wave Period (s)', 'Tidal Predictions', 'Neap/Spring Cycle'],
    resolution: 'Point-based',
    update: 'Hourly',
    type: 'Tidal',
  },
  {
    name: 'OpenTopography GEBCO',
    key: 'opentopography',
    description: 'Global bathymetry data from SRTM15+. Provides seafloor topography and base depth measurements for oceans and coastal regions.',
    icon: Layers,
    color: 'var(--accent-teal)',
    bg: 'var(--accent-teal-dim)',
    features: ['Base Depth (m)', 'Seafloor Topography', 'SRTM15+ DEM', 'Coastal Elevation', 'Resolution: 10-100m', 'Global Coverage'],
    resolution: '~450m (15 arc-sec)',
    update: 'Static dataset',
    type: 'Bathymetry',
  },
  {
    name: 'DIGIPIN Grid Engine',
    key: 'digipin_grid',
    description: 'Procedural generation of 95K+ geocoded monitoring locations across Indian coastline, major rivers, lakes, and reservoirs.',
    icon: Compass,
    color: 'var(--accent-purple)',
    bg: 'var(--accent-purple-dim)',
    features: ['95K+ Locations', 'Lat/Lon Encoding', 'Water Body Classification', 'Coastal Coverage', 'River Corridors', 'Lake/Reservoir Mapping'],
    resolution: '0.1° spacing (~11km)',
    update: 'Computed on startup',
    type: 'Geospatial',
  },
  {
    name: 'Satellite Altimetry (derived)',
    key: 'open_meteo_marine',
    description: 'Sea-surface-height indicators derived from Open-Meteo Marine model output (not direct Jason-3 / SARAL telemetry).',
    icon: Satellite,
    color: 'var(--accent-orange)',
    bg: 'var(--accent-orange-dim)',
    features: ['Sea Surface Height', 'Jason-3 Data', 'SARAL/AltiKa', 'Significant Wave Height', 'Wind Speed', 'Orbit Pass Data'],
    resolution: 'Along-track ~7km',
    update: '10-day cycle',
    type: 'Satellite',
  },
  {
    name: 'GloFAS River Discharge',
    key: 'open_meteo_flood',
    description: 'Modelled river discharge from the GloFAS system via the Open-Meteo Flood API. Drives inland depth and flood-risk scoring.',
    icon: Activity,
    color: 'var(--accent-cyan)',
    bg: 'var(--accent-cyan-dim)',
    features: ['River Discharge (m³/s)', 'Flow Rate', 'Basin Connectivity', 'Monsoon Index', 'Seasonal Variation', 'Flood Indicators'],
    resolution: 'Station-based',
    update: 'Daily',
    type: 'Hydrological',
  },
];

const STATUS_UI = {
  online:         { label: 'Online',         color: 'var(--accent-green)',  dot: 'online' },
  configured:     { label: 'Key configured', color: 'var(--accent-green)',  dot: 'online' },
  degraded:       { label: 'Degraded',       color: 'var(--accent-orange)', dot: 'degraded' },
  offline:        { label: 'Offline',        color: 'var(--accent-red)',    dot: 'offline' },
  not_configured: { label: 'No API key (using model fallback)', color: 'var(--accent-orange)', dot: 'degraded' },
  unknown:        { label: 'Checking…',      color: 'var(--text-tertiary)', dot: 'degraded' },
};

export default function DataSources() {
  const [selectedSource, setSelectedSource] = useState(null);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    getSystemStatus().then(setStatus).catch(() => setStatus({ sources: [], failed: true }));
  }, []);

  const statusOf = (key) => status?.sources?.find((x) => x.key === key);

  return (
    <div className="page">
      <motion.div className="page-header" {...fadeUp}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--accent-blue-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Database size={20} style={{ color: 'var(--accent-teal)' }} />
          </div>
          <div>
            <h1 className="page-title">Data Sources</h1>
            <p className="page-subtitle">Live data pipelines powering depth predictions across Indian water bodies</p>
          </div>
        </div>
      </motion.div>

      {/* System overview */}
      <motion.div className="stats-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }} {...fadeUp} transition={{ delay: 0.1 }}>
        {[
          { label: 'Sources Healthy', value: status ? (status.failed ? '—' : `${status.online}/${status.total}`) : '…', icon: <Database size={16} />, color: 'var(--accent-blue)', bg: 'var(--accent-blue-dim)' },
          { label: 'Avg Upstream Latency', value: status?.avg_latency_ms != null ? `${status.avg_latency_ms}ms` : '—', icon: <Activity size={16} />, color: 'var(--accent-green)', bg: 'var(--accent-green-dim)' },
          { label: 'Locations Indexed', value: status?.locations_indexed ? status.locations_indexed.toLocaleString() : '—', icon: <Zap size={16} />, color: 'var(--accent-orange)', bg: 'var(--accent-orange-dim)' },
          { label: 'Model', value: 'Physics fusion', icon: <HardDrive size={16} />, color: 'var(--accent-purple)', bg: 'var(--accent-purple-dim)' },
        ].map(({ label, value, icon, color, bg }, i) => (
          <motion.div key={label} className="glass-card stat-card" {...fadeUp} transition={{ delay: 0.12 + i * 0.04 }}>
            <div className="stat-card-header">
              <span className="stat-card-label">{label}</span>
              <div className="stat-card-icon" style={{ background: bg, color }}>{icon}</div>
            </div>
            <div className="stat-card-value">{value}</div>
          </motion.div>
        ))}
      </motion.div>

      {/* Architecture Pipeline */}
      <motion.div className="glass-card glass-card--no-hover" style={{ marginBottom: 'var(--space-6)' }} {...fadeUp} transition={{ delay: 0.2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px' }}>
          <Cpu size={16} style={{ color: 'var(--accent-indigo)' }} />
          <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>Data Fusion Pipeline</span>
        </div>

        <div className="equation-display" style={{ marginBottom: '20px' }}>
          <span className="var-highlight">Depth</span> = Base_Depth + <span className="var-highlight">α</span>·Rainfall + <span className="var-highlight">β</span>·Tide + <span className="var-highlight">γ</span>·Discharge − <span className="var-highlight">δ</span>·Evaporation
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: '12px', flexWrap: 'wrap', padding: '16px 0',
        }}>
          {['DIGIPIN Grid', 'Weather API', 'Tide API', 'Bathymetry API'].map((src, i) => (
            <React.Fragment key={src}>
              <div style={{
                padding: '10px 18px', borderRadius: 'var(--radius-md)',
                background: 'rgba(10,132,255,0.06)', border: '1px solid rgba(10,132,255,0.1)',
                fontSize: '12px', fontWeight: 600, color: 'var(--accent-teal)',
              }}>
                {src}
              </div>
              {i < 3 && (
                <div style={{ color: 'var(--text-quaternary)', fontSize: '18px' }}>→</div>
              )}
            </React.Fragment>
          ))}
          <div style={{ color: 'var(--text-quaternary)', fontSize: '18px' }}>→</div>
          <div style={{
            padding: '10px 18px', borderRadius: 'var(--radius-md)',
            background: 'rgba(48,209,88,0.08)', border: '1px solid rgba(48,209,88,0.15)',
            fontSize: '12px', fontWeight: 700, color: 'var(--accent-green)',
          }}>
            ⚡ Physics Engine
          </div>
          <div style={{ color: 'var(--text-quaternary)', fontSize: '18px' }}>→</div>
          <div style={{
            padding: '10px 18px', borderRadius: 'var(--radius-md)',
            background: 'var(--gradient-ocean)', fontSize: '12px', fontWeight: 700, color: '#fff',
          }}>
            Depth Forecast
          </div>
        </div>
      </motion.div>

      {/* Source cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(380px, 100%), 1fr))', gap: 'var(--space-4)' }}>
        {DATA_SOURCES.map((source, i) => {
          const Icon = source.icon;
          return (
            <motion.div
              key={source.name}
              className="glass-card data-source-card"
              style={{ flexDirection: 'column', cursor: 'pointer' }}
              {...fadeUp}
              transition={{ delay: 0.25 + i * 0.06 }}
              onClick={() => setSelectedSource(selectedSource === i ? null : i)}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px', width: '100%' }}>
                <div className="data-source-icon" style={{ background: source.bg, color: source.color }}>
                  <Icon size={20} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                    <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 700 }}>{source.name}</h3>
                    {(() => {
                      const st = statusOf(source.key);
                      const ui = STATUS_UI[st?.status || (status ? 'offline' : 'unknown')];
                      return (
                        <div className="data-source-status" title={st?.detail || ''}>
                          <span className={`status-dot ${ui.dot}`} />
                          <span style={{ color: ui.color }}>{ui.label}{st?.latency_ms != null ? ` · ${st.latency_ms}ms` : ''}</span>
                        </div>
                      );
                    })()}
                  </div>
                  <p style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: '10px' }}>
                    {source.description}
                  </p>
                  <div style={{ display: 'flex', gap: '12px', fontSize: '10px' }}>
                    <span style={{ color: 'var(--text-tertiary)' }}>
                      <Clock size={10} style={{ verticalAlign: 'middle', marginRight: '3px' }} />
                      {source.update}
                    </span>
                    <span style={{ color: 'var(--text-tertiary)' }}>
                      <Radio size={10} style={{ verticalAlign: 'middle', marginRight: '3px' }} />
                      {source.resolution}
                    </span>
                    <span className={`chip`} style={{ fontSize: '9px', padding: '1px 8px' }}>
                      {source.type}
                    </span>
                  </div>
                </div>
              </div>

              {/* Expanded features */}
              {selectedSource === i && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.04)', width: '100%' }}
                >
                  <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px' }}>
                    Available Features
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                    {source.features.map((f) => (
                      <div key={f} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                        <CheckCircle2 size={12} style={{ color: source.color, flexShrink: 0 }} />
                        {f}
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
