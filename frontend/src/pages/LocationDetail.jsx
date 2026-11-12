import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line,
} from 'recharts';
import {
  ArrowLeft, Droplets, Waves, CloudRain, Thermometer, Wind, Gauge,
  TrendingUp, AlertTriangle, Clock, MapPin, Navigation, Zap, Satellite,
  Activity, Radio,
} from 'lucide-react';
import {
  getCurrentDepth, getDepthForecast, getDepthHistory,
  getWeather, getTide, getFloodRisk, getLocationDetail, getSatelliteData,
} from '../services/api';

const fadeUp = { initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 } };

export default function LocationDetail() {
  const { digipin } = useParams();
  const navigate = useNavigate();

  const [location, setLocation] = useState(null);
  const [depth, setDepth] = useState(null);
  const [forecast, setForecast] = useState(null);
  const [history, setHistory] = useState(null);
  const [weather, setWeather] = useState(null);
  const [tide, setTide] = useState(null);
  const [floodRisk, setFloodRisk] = useState(null);
  const [satellite, setSatellite] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!digipin) return;

    (async () => {
      setIsLoading(true);
      try {
        const results = await Promise.allSettled([
          getLocationDetail(digipin),
          getCurrentDepth({ digipin }),
          getDepthForecast({ digipin, hours_ahead: 48 }),
          getDepthHistory(digipin, 72),
          getWeather({ digipin }),
          getTide({ digipin }),
          getFloodRisk({ digipin }),
          getSatelliteData(digipin),
        ]);

        if (results[0].status === 'fulfilled') setLocation(results[0].value);
        if (results[1].status === 'fulfilled') setDepth(results[1].value);
        if (results[2].status === 'fulfilled') setForecast(results[2].value);
        if (results[3].status === 'fulfilled') setHistory(results[3].value);
        if (results[4].status === 'fulfilled') setWeather(results[4].value);
        if (results[5].status === 'fulfilled') setTide(results[5].value);
        if (results[6].status === 'fulfilled') setFloodRisk(results[6].value);
        if (results[7].status === 'fulfilled') setSatellite(results[7].value);
      } catch (err) {
        console.error('Failed to load location data:', err);
      } finally {
        setIsLoading(false);
      }
    })();
  }, [digipin]);

  if (isLoading) {
    return (
      <div className="loading-state" style={{ height: '100vh' }}>
        <div className="spinner" />
        <span>Loading location data...</span>
      </div>
    );
  }

  const riskColor = getRiskColor(floodRisk?.alert_level);
  const circumference = 2 * Math.PI * 46;
  const riskOffset = circumference - (floodRisk?.risk_score || 0) * circumference;

  const forecastData = forecast?.forecast?.slice(0, 48).map((f, i) => ({
    hour: i, label: `+${i}h`, depth: f.predicted_depth,
    low: f.confidence_low, high: f.confidence_high, tide: f.tidal_component,
  })) || [];

  const historyData = history?.readings?.filter((_, i) => i % 3 === 0).map((r) => ({
    time: new Date(r.timestamp).toLocaleString('en-IN', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }),
    depth: r.computed_depth, tide: r.tidal_offset,
  })) || [];

  return (
    <div className="page" style={{ paddingBottom: '64px' }}>
      {/* Header */}
      <motion.div className="detail-header" {...fadeUp}>
        <button className="detail-back" onClick={() => navigate('/')}>
          <ArrowLeft size={18} />
        </button>
        <div style={{ flex: 1 }}>
          <h1 className="page-title" style={{ fontSize: 'var(--text-2xl)' }}>
            {location?.name || `Location ${digipin?.slice(0, 6)}`}
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px', flexWrap: 'wrap' }}>
            <span className={`chip ${location?.water_body_type}`}>{location?.water_body_type}</span>
            <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
              <MapPin size={11} style={{ verticalAlign: 'middle' }} /> {location?.latitude?.toFixed(4)}°N, {location?.longitude?.toFixed(4)}°E
            </span>
            <span style={{ fontSize: '10px', color: 'var(--text-quaternary)', fontFamily: 'var(--font-mono)' }}>
              {digipin}
            </span>
          </div>
        </div>
      </motion.div>

      {/* Physics equation */}
      <motion.div {...fadeUp} transition={{ delay: 0.05 }} style={{ marginBottom: 'var(--space-5)' }}>
        <div className="equation-display">
          <Zap size={13} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
          Depth = <span className="var-highlight">{depth?.base_depth?.toFixed(1) || '—'}</span>m
          + <span className="var-highlight">{depth?.tidal_offset >= 0 ? '+' : ''}{depth?.tidal_offset?.toFixed(2) || '0'}</span>m (tide)
          + <span className="var-highlight">+{depth?.rainfall_impact?.toFixed(2) || '0'}</span>m (rain)
          = <span className="var-highlight" style={{ color: 'var(--accent-teal)', fontSize: 'var(--text-base)' }}>{depth?.computed_depth?.toFixed(1) || '—'}m</span>
        </div>
      </motion.div>

      {/* Hero — 3 cards */}
      <div className="detail-hero">
        {/* Current depth */}
        <motion.div className="glass-card glass-card--elevated hero-depth-card" {...fadeUp} transition={{ delay: 0.1 }}>
          <Droplets size={24} style={{ color: 'var(--accent-teal)' }} />
          <div className="hero-depth-value">
            {depth?.computed_depth?.toFixed(1) || '—'}<span className="hero-depth-unit"> m</span>
          </div>
          <div className="depth-gauge-label">Current Water Depth</div>
          <div style={{ display: 'flex', gap: '20px', marginTop: '12px' }}>
            <SmallChip label="Base" value={`${depth?.base_depth?.toFixed(1) || '—'}m`} />
            <SmallChip label="Tide" value={`${depth?.tidal_offset >= 0 ? '+' : ''}${depth?.tidal_offset?.toFixed(2) || '0'}m`} />
            <SmallChip label="Rain" value={`+${depth?.rainfall_impact?.toFixed(2) || '0'}m`} />
          </div>
        </motion.div>

        {/* Tide */}
        <motion.div className="glass-card glass-card--elevated" {...fadeUp} transition={{ delay: 0.15 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <Waves size={18} style={{ color: 'var(--accent-blue)' }} />
            <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>Tidal Conditions</span>
          </div>
          <div style={{ textAlign: 'center', marginBottom: '16px' }}>
            <div style={{ fontSize: 'var(--text-3xl)', fontWeight: 700 }}>
              {tide?.sea_level_m?.toFixed(2) || '0.00'}
              <span style={{ fontSize: 'var(--text-base)', color: 'var(--text-secondary)' }}> m</span>
            </div>
            <div className="depth-gauge-label">{tide?.tide_phase || 'unknown'} tide</div>
          </div>
          <div className="tide-wave-container">
            <svg className="tide-wave-svg" viewBox="0 0 800 80" preserveAspectRatio="none">
              <defs>
                <linearGradient id="waveGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" style={{ stopColor: '#0A84FF', stopOpacity: 0.25 }} />
                  <stop offset="100%" style={{ stopColor: '#0A84FF', stopOpacity: 0 }} />
                </linearGradient>
              </defs>
              <path d="M0,40 C50,20 100,60 150,40 C200,20 250,60 300,40 C350,20 400,60 450,40 C500,20 550,60 600,40 C650,20 700,60 750,40 L800,40 L800,80 L0,80 Z" fill="url(#waveGrad)" />
              <path d="M0,40 C50,20 100,60 150,40 C200,20 250,60 300,40 C350,20 400,60 450,40 C500,20 550,60 600,40 C650,20 700,60 750,40" fill="none" stroke="#0A84FF" strokeWidth="2" />
            </svg>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '12px' }}>
            <SmallChip label="Wave Height" value={`${tide?.wave_height_m?.toFixed(1) || 0}m`} />
            <SmallChip label="Wave Period" value={`${tide?.wave_period_s?.toFixed(1) || 0}s`} />
          </div>
        </motion.div>

        {/* Flood risk */}
        <motion.div className="glass-card glass-card--elevated" {...fadeUp} transition={{ delay: 0.2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <AlertTriangle size={18} style={{ color: riskColor }} />
            <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>Flood Risk</span>
            <span className={`alert-badge ${floodRisk?.alert_level}`} style={{ marginLeft: 'auto' }}>
              {floodRisk?.alert_level || 'none'}
            </span>
          </div>
          <div className="risk-gauge" style={{ marginBottom: '12px' }}>
            <div className="risk-gauge-ring">
              <svg viewBox="0 0 100 100">
                <circle className="risk-gauge-bg" cx="50" cy="50" r="46" />
                <circle className="risk-gauge-progress" cx="50" cy="50" r="46"
                  stroke={riskColor} strokeDasharray={circumference} strokeDashoffset={riskOffset} />
              </svg>
              <div className="risk-gauge-center">
                <div className="risk-gauge-score" style={{ color: riskColor }}>
                  {((floodRisk?.risk_score || 0) * 100).toFixed(0)}%
                </div>
              </div>
            </div>
          </div>
          <p style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.5, textAlign: 'center' }}>
            {floodRisk?.details?.slice(0, 140) || 'No risk data available.'}
          </p>
        </motion.div>
      </div>

      {/* Charts section */}
      <div className="detail-sections">
        {/* Forecast chart */}
        <motion.div className="glass-card glass-card--no-hover" {...fadeUp} transition={{ delay: 0.3 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <TrendingUp size={16} style={{ color: 'var(--accent-teal)' }} />
            <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>48-Hour Depth Forecast</span>
          </div>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={forecastData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#555' }} interval={5} />
                <YAxis tick={{ fontSize: 10, fill: '#555' }} domain={['auto', 'auto']} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="high" stroke="none" fill="rgba(100,210,255,0.06)" />
                <Area type="monotone" dataKey="depth" stroke="#64D2FF" fill="rgba(100,210,255,0.12)" strokeWidth={2} dot={false} />
                <Area type="monotone" dataKey="low" stroke="none" fill="rgba(100,210,255,0.04)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        {/* History chart */}
        <motion.div className="glass-card glass-card--no-hover" {...fadeUp} transition={{ delay: 0.35 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <Clock size={16} style={{ color: 'var(--accent-blue)' }} />
            <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>72-Hour History</span>
          </div>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={historyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
                <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#555' }} interval={Math.floor(historyData.length / 6) || 1} />
                <YAxis yAxisId="depth" tick={{ fontSize: 10, fill: '#777' }} domain={['auto', 'auto']} unit="m" width={48} />
                <YAxis yAxisId="tide" orientation="right" tick={{ fontSize: 10, fill: '#64D2FF' }} domain={['auto', 'auto']} unit="m" width={44} />
                <Tooltip content={<ChartTooltip />} />
                <Line yAxisId="depth" type="monotone" dataKey="depth" name="Depth" stroke="#0A84FF" strokeWidth={2} dot={false} />
                <Line yAxisId="tide" type="monotone" dataKey="tide" name="Tide offset" stroke="#64D2FF" strokeWidth={1.5} dot={false} strokeDasharray="4 4" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        {/* Weather panel */}
        <motion.div className="glass-card glass-card--no-hover" {...fadeUp} transition={{ delay: 0.4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <CloudRain size={16} style={{ color: 'var(--accent-green)' }} />
            <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>Weather Conditions</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <WeatherStat icon={<Thermometer size={18} />} label="Temperature" value={`${weather?.temperature_c?.toFixed(1) || '—'}°C`} color="var(--accent-orange)" />
            <WeatherStat icon={<CloudRain size={18} />} label="Precipitation" value={`${weather?.precipitation_mm?.toFixed(1) || '0'} mm/h`} color="var(--accent-blue)" />
            <WeatherStat icon={<Wind size={18} />} label="Wind Speed" value={`${weather?.wind_speed_ms?.toFixed(1) || '—'} m/s`} color="var(--text-secondary)" />
            <WeatherStat icon={<Droplets size={18} />} label="Humidity" value={`${weather?.humidity_pct?.toFixed(0) || '—'}%`} color="var(--accent-teal)" />
            <WeatherStat icon={<Gauge size={18} />} label="Pressure" value={`${weather?.pressure_hpa?.toFixed(0) || '—'} hPa`} color="var(--accent-purple)" />
            <WeatherStat icon={<CloudRain size={18} />} label="Rain (72h)" value={`${weather?.precipitation_72h?.toFixed(1) || '0'} mm`} color="var(--accent-green)" />
          </div>
        </motion.div>

        {/* Satellite + Model info */}
        <motion.div className="glass-card glass-card--no-hover" {...fadeUp} transition={{ delay: 0.45 }}>
          {/* Satellite section */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <Satellite size={16} style={{ color: 'var(--accent-orange)' }} />
            <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>Satellite & Model</span>
          </div>

          {satellite && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '16px' }}>
              <SmallChip label="SSH" value={`${satellite.ssh_m?.toFixed(2) || '—'}m`} />
              <SmallChip label="SWH" value={`${satellite.swh_m?.toFixed(2) || '—'}m`} />
              <SmallChip label="Wind" value={`${satellite.wind_speed_ms?.toFixed(1) || '—'} m/s`} />
              <SmallChip label="Source" value={satellite.source || 'Jason-3'} />
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <InfoRow label="DIGIPIN" value={digipin} mono />
            <InfoRow label="Water Body" value={location?.water_body_type} />
            <InfoRow label="Shore Distance" value={`${location?.shore_distance_km?.toFixed(1) || '—'} km`} />
            <InfoRow label="Base Depth" value={`${location?.base_depth?.toFixed(2) || '—'} m`} />
            <InfoRow label="Model" value={depth?.model_version || 'physics-v1'} mono />
            <InfoRow label="Confidence" value={`${((depth?.confidence || 0.75) * 100).toFixed(0)}%`} />
            <InfoRow label="Monsoon Index" value={weather?.monsoon_index?.toFixed(2) || '—'} />
          </div>
        </motion.div>
      </div>
    </div>
  );
}

function SmallChip({ label, value }) {
  return (
    <div style={{ textAlign: 'center', padding: '8px', borderRadius: '8px', background: 'rgba(255,255,255,0.025)' }}>
      <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginBottom: '3px' }}>{label}</div>
      <div style={{ fontSize: '13px', fontWeight: 600 }}>{value}</div>
    </div>
  );
}

function WeatherStat({ icon, label, value, color }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '12px',
      padding: '12px', borderRadius: '10px', background: 'rgba(255,255,255,0.025)',
    }}>
      <div style={{ color }}>{icon}</div>
      <div>
        <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{label}</div>
        <div style={{ fontSize: 'var(--text-base)', fontWeight: 600 }}>{value}</div>
      </div>
    </div>
  );
}

function InfoRow({ label, value, mono }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
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

function getRiskColor(level) {
  return {
    critical: 'var(--accent-red)',
    high: 'var(--accent-orange)',
    moderate: 'var(--accent-yellow)',
    low: 'var(--accent-green)',
  }[level] || 'var(--text-tertiary)';
}
