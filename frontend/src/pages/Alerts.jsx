import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle, MapPin, Clock, ChevronRight, Shield, RefreshCw,
  Filter, Zap, Activity, Radio,
} from 'lucide-react';
import { getActiveAlerts } from '../services/api';

const fadeUp = { initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 } };

export default function Alerts() {
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState([]);
  const [scanned, setScanned] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  const loadAlerts = async () => {
    setIsLoading(true);
    setLoadError(false);
    try {
      const data = await getActiveAlerts();
      setAlerts(data.alerts || []);
      setScanned(data.locations_ok ?? (data.alerts || []).length);
    } catch (err) {
      console.error('Failed to load alerts:', err);
      setLoadError(true);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { loadAlerts(); }, []);

  // The API returns every scanned location; only non-"none" levels are real alerts.
  const activeAlerts = alerts.filter(a => a.alert_level !== 'none');
  const normalLocations = alerts.filter(a => a.alert_level === 'none');

  const filteredAlerts = filter === 'all'
    ? activeAlerts
    : activeAlerts.filter(a => a.alert_level === filter);

  const counts = {
    all: activeAlerts.length,
    critical: alerts.filter(a => a.alert_level === 'critical').length,
    high: alerts.filter(a => a.alert_level === 'high').length,
    moderate: alerts.filter(a => a.alert_level === 'moderate').length,
    low: alerts.filter(a => a.alert_level === 'low').length,
  };

  const filterCards = [
    { key: 'all', label: 'Total', count: counts.all, icon: <Activity size={16} />, color: 'var(--accent-blue)', bg: 'var(--accent-blue-dim)' },
    { key: 'critical', label: 'Critical', count: counts.critical, icon: <Zap size={16} />, color: 'var(--accent-red)', bg: 'var(--accent-red-dim)' },
    { key: 'high', label: 'High', count: counts.high, icon: <AlertTriangle size={16} />, color: 'var(--accent-orange)', bg: 'var(--accent-orange-dim)' },
    { key: 'moderate', label: 'Moderate', count: counts.moderate, icon: <Shield size={16} />, color: 'var(--accent-yellow)', bg: 'var(--accent-yellow-dim)' },
    { key: 'low', label: 'Low', count: counts.low, icon: <Shield size={16} />, color: 'var(--accent-green)', bg: 'var(--accent-green-dim)' },
  ];

  return (
    <div className="page">
      <motion.div className="page-header" {...fadeUp}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--accent-orange-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <AlertTriangle size={20} style={{ color: 'var(--accent-orange)' }} />
            </div>
            <div>
              <h1 className="page-title">Alerts</h1>
              <p className="page-subtitle">Real-time flood risk monitoring across Indian water bodies</p>
            </div>
          </div>
          <motion.button
            className="btn btn-secondary"
            onClick={loadAlerts}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <RefreshCw size={14} />
            Refresh
          </motion.button>
        </div>
      </motion.div>

      {/* Filter cards */}
      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
        {filterCards.map(({ key, label, count, icon, color, bg }, i) => (
          <motion.div
            key={label}
            className="glass-card stat-card glass-card--interactive"
            style={{
              cursor: 'pointer',
              borderColor: filter === key ? color : undefined,
              boxShadow: filter === key ? `0 0 20px ${color}20` : undefined,
            }}
            {...fadeUp}
            transition={{ delay: 0.1 + i * 0.04 }}
            onClick={() => setFilter(filter === key ? 'all' : key)}
          >
            <div className="stat-card-header">
              <span className="stat-card-label">{label}</span>
              <div className="stat-card-icon" style={{ background: bg, color }}>{icon}</div>
            </div>
            <div className="stat-card-value" style={{ color: count > 0 ? color : 'var(--text-primary)' }}>
              {count}
            </div>
          </motion.div>
        ))}
      </div>

      {/* Active filter indicator */}
      {filter !== 'all' && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          style={{ marginBottom: 'var(--space-4)', display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          <Filter size={12} style={{ color: 'var(--text-tertiary)' }} />
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            Showing <strong>{filter}</strong> alerts
          </span>
          <button
            className="btn btn-ghost"
            style={{ padding: '2px 8px', fontSize: '11px' }}
            onClick={() => setFilter('all')}
          >
            Clear
          </button>
        </motion.div>
      )}

      {/* Alert list */}
      {isLoading ? (
        <div className="loading-state">
          <div className="spinner" />
          <span>Scanning water bodies for risks...</span>
        </div>
      ) : loadError ? (
        <div className="glass-card glass-card--no-hover">
          <div className="empty-state" style={{ padding: '48px 20px' }}>
            <AlertTriangle size={40} style={{ opacity: 0.3 }} />
            <div style={{ fontSize: 'var(--text-lg)', fontWeight: 700 }}>Couldn't load alerts</div>
            <div style={{ fontSize: 'var(--text-sm)' }}>The backend didn't respond. Check that the API is running, then press Refresh.</div>
          </div>
        </div>
      ) : filteredAlerts.length === 0 ? (
        <motion.div className="glass-card glass-card--no-hover" {...fadeUp} transition={{ delay: 0.3 }}>
          <div className="empty-state" style={{ padding: '60px 20px' }}>
            <Shield size={56} style={{ opacity: 0.15 }} />
            <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700, marginTop: '8px' }}>All Clear</div>
            <div style={{ fontSize: 'var(--text-sm)', maxWidth: '400px', lineHeight: 1.6 }}>
              No active alerts matching the current filter. All {scanned} monitored locations are currently within normal range.
            </div>
          </div>
        </motion.div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <AnimatePresence>
            {filteredAlerts.map((alert, i) => (
              <AlertCard key={alert.digipin + i} alert={alert} i={i} onOpen={() => navigate(`/location/${alert.digipin}`)} />
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Monitored locations with no alert */}
      {!isLoading && !loadError && filter === 'all' && normalLocations.length > 0 && (
        <div style={{ marginTop: 'var(--space-6)' }}>
          <div className="section-label" style={{ fontSize: 'var(--text-xs)', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-tertiary)', fontWeight: 600, marginBottom: '10px' }}>
            Monitored · within normal range ({normalLocations.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {normalLocations.map((alert, i) => (
              <AlertCard key={alert.digipin + i} alert={alert} i={i} onOpen={() => navigate(`/location/${alert.digipin}`)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AlertCard({ alert, i, onOpen }) {
  return (
    <motion.div
      className="glass-card alert-card glass-card--interactive"
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      transition={{ delay: Math.min(i, 10) * 0.04 }}
      onClick={onOpen}
    >
      <div className={`alert-indicator ${alert.alert_level}`} />
      <div className="alert-content">
        <div className="alert-title">{alert.name}</div>
        <div className="alert-details">{alert.details}</div>
        <div className="alert-meta">
          <MapPin size={10} style={{ verticalAlign: 'middle' }} />{' '}
          {alert.latitude?.toFixed(3)}°N, {alert.longitude?.toFixed(3)}°E
          {' '}·{' '}
          <Clock size={10} style={{ verticalAlign: 'middle' }} />{' '}
          {alert.timestamp ? new Date(alert.timestamp).toLocaleTimeString('en-IN') : ''}
        </div>
      </div>
      <span className={`alert-badge ${alert.alert_level}`}>{alert.alert_level}</span>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px', minWidth: '55px' }}>
        <div style={{ fontSize: 'var(--text-lg)', fontWeight: 700, color: getRiskColor(alert.alert_level) }}>
          {(alert.risk_score * 100).toFixed(0)}%
        </div>
        <ChevronRight size={14} style={{ color: 'var(--text-quaternary)' }} />
      </div>
    </motion.div>
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
