import React, { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell,
} from 'recharts';
import {
  TrendingUp, Search, MapPin, Droplets, Waves, CloudRain,
  Gauge, Clock, Zap, ArrowRight,
} from 'lucide-react';
import { searchLocations, getDepthForecast, getCurrentDepth } from '../services/api';

const fadeUp = { initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 } };

export default function Forecast() {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [selectedLoc, setSelectedLoc] = useState(null);
  const [forecast, setForecast] = useState(null);
  const [depth, setDepth] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSearch = useCallback(async (q) => {
    setQuery(q);
    if (q.length < 2) { setSuggestions([]); return; }
    try {
      const data = await searchLocations(q);
      setSuggestions(data.locations || []);
    } catch { setSuggestions([]); }
  }, []);

  const selectLocation = async (loc) => {
    setSelectedLoc(loc);
    setForecast(null);
    setDepth(null);
    setSuggestions([]);
    setQuery(loc.name);
    setIsLoading(true);

    try {
      const [fc, dp] = await Promise.allSettled([
        getDepthForecast({ digipin: loc.digipin, hours_ahead: 48 }),
        getCurrentDepth({ digipin: loc.digipin }),
      ]);
      if (fc.status === 'fulfilled') setForecast(fc.value);
      if (dp.status === 'fulfilled') setDepth(dp.value);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const quickPick = async (city) => {
    setQuery(city);
    try {
      const data = await searchLocations(city);
      if (data.locations?.length) selectLocation(data.locations[0]);
    } catch { /* ignore */ }
  };

  const forecastData = forecast?.forecast?.slice(0, 48).map((f, i) => ({
    hour: `+${i}h`,
    depth: f.predicted_depth,
    low: f.confidence_low,
    high: f.confidence_high,
    tide: f.tidal_component,
  })) || [];

  const components = depth ? [
    { name: 'Base', value: depth.base_depth, color: '#0A84FF' },
    { name: 'Tidal', value: Math.abs(depth.tidal_offset), color: '#64D2FF' },
    { name: 'Rain', value: depth.rainfall_impact, color: '#30D158' },
    { name: 'Discharge', value: Math.abs(depth.discharge_delta || 0), color: '#BF5AF2' },
  ] : [];

  return (
    <div className="page">
      <motion.div className="page-header" {...fadeUp}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--accent-teal-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <TrendingUp size={20} style={{ color: 'var(--accent-teal)' }} />
          </div>
          <div>
            <h1 className="page-title">Depth Forecast</h1>
            <p className="page-subtitle">48-hour water depth predictions with confidence intervals</p>
          </div>
        </div>
      </motion.div>

      {/* Search */}
      <motion.div {...fadeUp} transition={{ delay: 0.1 }} style={{ marginBottom: 'var(--space-6)', maxWidth: '600px' }}>
        <div className="search-bar">
          <Search size={15} />
          <input
            type="text"
            placeholder="Search a DIGIPIN location to forecast..."
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
          />
        </div>
        {suggestions.length > 0 && (
          <div className="glass-card" style={{ marginTop: '4px', padding: 'var(--space-2)' }}>
            {suggestions.slice(0, 5).map((loc, i) => (
              <div key={loc.digipin || i} className="location-card" onClick={() => selectLocation(loc)}>
                <MapPin size={13} style={{ color: 'var(--accent-teal)', flexShrink: 0 }} />
                <div className="location-card-info">
                  <div className="location-card-name">{loc.name}</div>
                  <div className="location-card-region">{loc.region} · {loc.water_body_type}</div>
                </div>
                <ArrowRight size={13} style={{ color: 'var(--text-quaternary)' }} />
              </div>
            ))}
          </div>
        )}
      </motion.div>

      {/* Loading */}
      {isLoading && (
        <div className="loading-state">
          <div className="spinner" />
          <span>Computing forecast...</span>
        </div>
      )}

      {/* Results */}
      {selectedLoc && !isLoading && (
        <>
          {/* Physics equation */}
          <motion.div {...fadeUp} transition={{ delay: 0.15 }} style={{ marginBottom: 'var(--space-6)' }}>
            <div className="equation-display">
              <Zap size={14} style={{ verticalAlign: 'middle', marginRight: '8px' }} />
              ΔDepth = <span className="var-highlight">α</span>·Rainfall + <span className="var-highlight">β</span>·Tide + <span className="var-highlight">γ</span>·Discharge − <span className="var-highlight">δ</span>·Evaporation
            </div>
          </motion.div>

          {/* Hero stats */}
          <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            {[
              { label: 'Current Depth', value: `${depth?.computed_depth?.toFixed(1) || '—'}m`, icon: <Droplets size={16} />, color: 'var(--accent-teal)', bg: 'var(--accent-teal-dim)' },
              { label: 'Tidal Offset', value: `${depth?.tidal_offset >= 0 ? '+' : ''}${depth?.tidal_offset?.toFixed(2) || '0'}m`, icon: <Waves size={16} />, color: 'var(--accent-blue)', bg: 'var(--accent-blue-dim)' },
              { label: 'Rain Impact', value: `+${depth?.rainfall_impact?.toFixed(2) || '0'}m`, icon: <CloudRain size={16} />, color: 'var(--accent-green)', bg: 'var(--accent-green-dim)' },
              { label: 'Confidence', value: `${((depth?.confidence || 0) * 100).toFixed(0)}%`, icon: <Gauge size={16} />, color: 'var(--accent-purple)', bg: 'var(--accent-purple-dim)' },
            ].map(({ label, value, icon, color, bg }, i) => (
              <motion.div key={label} className="glass-card stat-card" {...fadeUp} transition={{ delay: 0.2 + i * 0.05 }}>
                <div className="stat-card-header">
                  <span className="stat-card-label">{label}</span>
                  <div className="stat-card-icon" style={{ background: bg, color }}>{icon}</div>
                </div>
                <div className="stat-card-value">{value}</div>
              </motion.div>
            ))}
          </div>

          {/* Charts */}
          <div className="two-col">
            {/* Forecast chart */}
            <motion.div className="glass-card glass-card--no-hover" {...fadeUp} transition={{ delay: 0.35 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                <TrendingUp size={16} style={{ color: 'var(--accent-teal)' }} />
                <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>48-Hour Depth Forecast</span>
              </div>
              <div className="chart-container">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={forecastData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
                    <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#555' }} interval={5} />
                    <YAxis tick={{ fontSize: 10, fill: '#555' }} domain={['auto', 'auto']} />
                    <Tooltip content={<ChartTooltip />} />
                    <Area type="monotone" dataKey="high" stroke="none" fill="rgba(100,210,255,0.06)" />
                    <Area type="monotone" dataKey="depth" stroke="#64D2FF" fill="rgba(100,210,255,0.12)" strokeWidth={2} dot={false} />
                    <Area type="monotone" dataKey="low" stroke="none" fill="rgba(100,210,255,0.04)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </motion.div>

            {/* Components breakdown */}
            <motion.div className="glass-card glass-card--no-hover" {...fadeUp} transition={{ delay: 0.4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                <Zap size={16} style={{ color: 'var(--accent-orange)' }} />
                <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>Depth Components</span>
              </div>
              <div className="chart-container">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={components} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
                    <XAxis type="number" tick={{ fontSize: 10, fill: '#555' }} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#86868B' }} width={70} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={24}>
                      {components.map((c, i) => (
                        <Cell key={i} fill={c.color} fillOpacity={0.7} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </motion.div>
          </div>

          {/* Model info */}
          <motion.div className="glass-card glass-card--no-hover" style={{ marginTop: '16px' }} {...fadeUp} transition={{ delay: 0.5 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <Clock size={16} style={{ color: 'var(--accent-indigo)' }} />
              <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>Model Information</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '12px' }}>
              <InfoRow label="Location" value={selectedLoc.name} />
              <InfoRow label="DIGIPIN" value={selectedLoc.digipin} mono />
              <InfoRow label="Water Body" value={selectedLoc.water_body_type} />
              <InfoRow label="Model" value={depth?.model_version || 'physics-v1'} mono />
              <InfoRow label="Forecast Hours" value="48h" />
              <InfoRow label="Inference" value="< 500ms" />
            </div>
          </motion.div>
        </>
      )}

      {/* Empty state */}
      {!selectedLoc && !isLoading && (
        <motion.div className="empty-state" style={{ padding: '80px 20px' }} {...fadeUp} transition={{ delay: 0.2 }}>
          <TrendingUp size={56} style={{ opacity: 0.15 }} />
          <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700, marginTop: '8px' }}>Select a Location</div>
          <div style={{ fontSize: 'var(--text-sm)', maxWidth: '400px', lineHeight: 1.6 }}>
            Search for a city, region or river to see 48-hour depth predictions with tidal, rainfall, and discharge components.
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginTop: 16 }}>
            {['Mumbai', 'Chennai', 'Kochi', 'Kolkata', 'Visakhapatnam', 'Varanasi'].map((c) => (
              <button key={c} className="btn btn-secondary" style={{ padding: '6px 14px', fontSize: 12 }} onClick={() => quickPick(c)}>
                {c}
              </button>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
}

function InfoRow({ label, value, mono }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, fontFamily: mono ? 'var(--font-mono)' : 'inherit' }}>{value}</span>
    </div>
  );
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-label">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="chart-tooltip-value" style={{ color: p.stroke || p.fill }}>
          {p.name}: {typeof p.value === 'number' ? p.value.toFixed(2) : p.value}
        </div>
      ))}
    </div>
  );
}
