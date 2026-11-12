import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
  AreaChart, Area, Legend,
} from 'recharts';
import {
  BarChart3, MapPin, Waves, Droplets, TrendingUp, Gauge, AlertTriangle,
  Clock, Database, Cpu, Activity, Zap, Globe,
} from 'lucide-react';
import { getAnalyticsOverview, getDepthDistribution, getSeasonalAnalysis, getHistoricalRainfall } from '../services/api';

const COLORS = ['#0A84FF', '#64D2FF', '#30D158', '#BF5AF2', '#FF9F0A'];

// Reference point for the climate charts (Mumbai region)
const REF_POINT = { lat: 19.076, lon: 72.878, label: 'Mumbai region' };
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const TOOLTIP_STYLE = {
  background: 'rgba(10,18,32,0.95)', border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: '12px', color: '#fff', fontSize: 12,
};

const fadeUp = { initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 } };

export default function Analytics() {
  const [overview, setOverview] = useState(null);
  const [distribution, setDistribution] = useState(null);
  const [seasonal, setSeasonal] = useState(null);
  const [rainfall, setRainfall] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [ov, dist, seas, rain] = await Promise.allSettled([
          getAnalyticsOverview(),
          getDepthDistribution(),
          getSeasonalAnalysis(REF_POINT.lat, REF_POINT.lon),
          getHistoricalRainfall(REF_POINT.lat, REF_POINT.lon, 90),
        ]);
        if (ov.status === 'fulfilled') setOverview(ov.value);
        if (dist.status === 'fulfilled') setDistribution(dist.value);
        if (seas.status === 'fulfilled') setSeasonal(seas.value);
        if (rain.status === 'fulfilled') setRainfall(rain.value);
      } catch (err) {
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  if (isLoading) {
    return (
      <div className="loading-state" style={{ height: '100vh' }}>
        <div className="spinner" />
        <span>Loading analytics...</span>
      </div>
    );
  }

  const pieData = overview ? [
    { name: 'Coastal', value: overview.coastal_locations || 0 },
    { name: 'Rivers', value: overview.river_locations || 0 },
    { name: 'Lakes', value: overview.lake_locations || 0 },
    { name: 'Reservoirs', value: overview.reservoir_locations || 0 },
  ] : [];

  const pieTotal = pieData.reduce((a, d) => a + d.value, 0) || 1;

  const barData = distribution?.distribution
    ? Object.entries(distribution.distribution).map(([type, data]) => ({
        type: type.charAt(0).toUpperCase() + type.slice(1),
        avg: data.avg_depth,
        max: data.max_depth,
        count: data.count,
      }))
    : [];

  // Real monsoon intensity by month (backend climatology model)
  const monsoonData = seasonal
    ? MONTHS.map((m, i) => ({ month: m, index: seasonal.monthly_monsoon_index?.[i + 1] ?? 0, current: seasonal.current_month === i + 1 }))
    : [];

  // Real ERA5 daily rainfall, last 90 days
  const rainData = (rainfall?.daily_precipitation || []).map((d) => ({
    date: new Date(d.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
    mm: d.precipitation_mm,
  }));

  return (
    <div className="page">
      <motion.div className="page-header" {...fadeUp}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--accent-blue-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <BarChart3 size={20} style={{ color: 'var(--accent-teal)' }} />
          </div>
          <div>
            <h1 className="page-title">Analytics</h1>
            <p className="page-subtitle">System-wide performance metrics, data distribution, and seasonal analysis</p>
          </div>
        </div>
      </motion.div>

      {/* Stat cards */}
      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
        {[
          { label: 'Total Locations', value: overview?.total_locations?.toLocaleString() || '0', icon: <MapPin size={16} />, color: 'var(--accent-blue)', bg: 'var(--accent-blue-dim)' },
          { label: 'Avg Depth', value: `${overview?.avg_depth_m?.toFixed(1) || 0}m`, icon: <Droplets size={16} />, color: 'var(--accent-teal)', bg: 'var(--accent-teal-dim)' },
          { label: 'Max Depth', value: `${overview?.max_depth_m?.toFixed(1) || 0}m`, icon: <TrendingUp size={16} />, color: 'var(--accent-green)', bg: 'var(--accent-green-dim)' },
          { label: 'Active Alerts', value: overview?.active_alerts || 0, icon: <AlertTriangle size={16} />, color: 'var(--accent-orange)', bg: 'var(--accent-orange-dim)' },
          { label: 'Cache Refresh', value: '5 min', icon: <Clock size={16} />, color: 'var(--accent-purple)', bg: 'var(--accent-purple-dim)' },
          { label: 'Model', value: 'Physics fusion', icon: <Cpu size={16} />, color: 'var(--accent-indigo)', bg: 'var(--accent-indigo-dim)' },
        ].map(({ label, value, icon, color, bg }, i) => (
          <motion.div key={label} className="glass-card stat-card" {...fadeUp} transition={{ delay: 0.1 + i * 0.04 }}>
            <div className="stat-card-header">
              <span className="stat-card-label">{label}</span>
              <div className="stat-card-icon" style={{ background: bg, color }}>{icon}</div>
            </div>
            <div className="stat-card-value">{value}</div>
          </motion.div>
        ))}
      </div>

      {/* Row 1: Pie + Bar */}
      <div className="two-col" style={{ marginBottom: 'var(--space-4)' }}>
        <motion.div className="glass-card glass-card--no-hover" {...fadeUp} transition={{ delay: 0.3 }}>
          <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: '16px' }}>
            <Globe size={14} style={{ verticalAlign: 'middle', marginRight: '8px', color: 'var(--accent-blue)' }} />
            Location Distribution
          </h3>
          <div style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%" cy="45%"
                  innerRadius={65} outerRadius={105}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} fillOpacity={0.8} />
                  ))}
                </Pie>
                <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={{ color: '#fff' }}
                  formatter={(v, n) => [`${Number(v).toLocaleString()} (${((v / pieTotal) * 100).toFixed(1)}%)`, n]} />
                <Legend verticalAlign="bottom" iconType="circle"
                  formatter={(v) => <span style={{ color: '#b0b0b8', fontSize: 12 }}>{v}</span>} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        <motion.div className="glass-card glass-card--no-hover" {...fadeUp} transition={{ delay: 0.35 }}>
          <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: '16px' }}>
            <Droplets size={14} style={{ verticalAlign: 'middle', marginRight: '8px', color: 'var(--accent-teal)' }} />
            Base Depth by Water Body Type <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>(log scale)</span>
          </h3>
          <div style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="type" tick={{ fontSize: 11, fill: '#8a8a93' }} />
                <YAxis scale="log" domain={[1, 'auto']} allowDataOverflow tick={{ fontSize: 11, fill: '#8a8a93' }} unit="m" width={56} />
                <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={{ color: '#fff' }} cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                  formatter={(v, n) => [`${Number(v).toFixed(1)} m`, n]} />
                <Legend iconType="circle" formatter={(v) => <span style={{ color: '#b0b0b8', fontSize: 12 }}>{v}</span>} />
                <Bar dataKey="avg" fill="#0A84FF" name="Avg depth" radius={[6, 6, 0, 0]} />
                <Bar dataKey="max" fill="#64D2FF" name="Max depth" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </motion.div>
      </div>

      {/* Row 2: real monsoon index + real rainfall */}
      <div className="two-col" style={{ marginBottom: 'var(--space-4)' }}>
        <motion.div className="glass-card glass-card--no-hover" {...fadeUp} transition={{ delay: 0.4 }}>
          <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: '4px' }}>
            <Activity size={14} style={{ verticalAlign: 'middle', marginRight: '8px', color: 'var(--accent-green)' }} />
            Monsoon Intensity by Month
          </h3>
          <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 12 }}>
            Climatological index (0–1) at {REF_POINT.label}{seasonal ? ` · now: ${seasonal.current_season}` : ''}
          </p>
          <div style={{ width: '100%', height: 260 }}>
            {monsoonData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monsoonData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#8a8a93' }} />
                  <YAxis domain={[0, 1]} tick={{ fontSize: 10, fill: '#8a8a93' }} width={32} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={{ color: '#fff' }} cursor={{ fill: 'rgba(255,255,255,0.03)' }} formatter={(v) => [Number(v).toFixed(2), 'Monsoon index']} />
                  <Bar dataKey="index" radius={[6, 6, 0, 0]}>
                    {monsoonData.map((d, i) => <Cell key={i} fill={d.current ? '#FF9F0A' : '#30D158'} fillOpacity={d.current ? 0.95 : 0.7} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : <div className="empty-state"><span>Seasonal data unavailable</span></div>}
          </div>
        </motion.div>

        <motion.div className="glass-card glass-card--no-hover" {...fadeUp} transition={{ delay: 0.45 }}>
          <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: '4px' }}>
            <TrendingUp size={14} style={{ verticalAlign: 'middle', marginRight: '8px', color: 'var(--accent-orange)' }} />
            Daily Rainfall — Last 90 Days
          </h3>
          <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 12 }}>
            ERA5 reanalysis at {REF_POINT.label}{rainfall ? ` · total ${rainfall.total_mm} mm` : ''}
          </p>
          <div style={{ width: '100%', height: 260 }}>
            {rainData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={rainData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#8a8a93' }} interval={Math.floor(rainData.length / 6)} />
                  <YAxis tick={{ fontSize: 10, fill: '#8a8a93' }} unit=" mm" width={52} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={{ color: '#fff' }} formatter={(v) => [`${Number(v).toFixed(1)} mm`, 'Rainfall']} />
                  <Area type="monotone" dataKey="mm" stroke="#64D2FF" fill="rgba(100,210,255,0.15)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            ) : <div className="empty-state"><span>Rainfall data unavailable</span></div>}
          </div>
        </motion.div>
      </div>

      {/* System info */}
      <motion.div className="glass-card glass-card--no-hover" {...fadeUp} transition={{ delay: 0.5 }}>
        <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: '16px' }}>
          <Database size={14} style={{ verticalAlign: 'middle', marginRight: '8px', color: 'var(--accent-indigo)' }} />
          System Information
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '12px' }}>
          <SysInfo label="Model" value="Physics-based depth fusion" />
                    <SysInfo label="Data Sources" value="Open-Meteo, StormGlass, GEBCO" />
          <SysInfo label="Last Updated" value={overview?.last_updated ? new Date(overview.last_updated).toLocaleString('en-IN') : '—'} />
          <SysInfo label="Coverage" value="Pan-India (EEZ + Inland)" />
          <SysInfo label="Grid Density" value="95K+ locations" />
        </div>
      </motion.div>
    </div>
  );
}

function SysInfo({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>{value}</span>
    </div>
  );
}
