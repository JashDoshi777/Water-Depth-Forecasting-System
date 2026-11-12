import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Compass, MapPin, Waves, Droplets, Search, ChevronLeft, ChevronRight,
  Fish, Mountain, ArrowUpDown,
} from 'lucide-react';
import { getAllLocations, searchLocations, getLocationStats } from '../services/api';

const fadeUp = { initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 } };
const PER_PAGE = 50;

const TYPE_ICONS = {
  ocean: <Waves size={14} />,
  river: <Droplets size={14} />,
  lake: <Fish size={14} />,
  reservoir: <Mountain size={14} />,
};

export default function Locations() {
  const navigate = useNavigate();
  const [locations, setLocations] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [activeTab, setActiveTab] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [stats, setStats] = useState(null);

  const loadLocations = useCallback(async (p = 0, type = '', q = '') => {
    setIsLoading(true);
    try {
      if (q.length >= 2) {
        const data = await searchLocations(q, type);
        setLocations(data.locations || []);
        setTotal(data.locations?.length || 0);
      } else {
        const data = await getAllLocations(PER_PAGE, p * PER_PAGE, type);
        setLocations(data.locations || []);
        setTotal(data.total || 0);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLocations(page, activeTab, searchQuery);
  }, [page, activeTab]);

  useEffect(() => {
    (async () => {
      try {
        const s = await getLocationStats();
        setStats(s);
      } catch {}
    })();
  }, []);

  const handleSearch = (q) => {
    setSearchQuery(q);
    setPage(0);
    if (q.length >= 2 || q.length === 0) {
      loadLocations(0, activeTab, q);
    }
  };

  const totalPages = Math.ceil(total / PER_PAGE);

  const tabs = [
    { key: '', label: 'All', count: stats?.total || '—' },
    { key: 'ocean', label: 'Ocean', count: stats?.by_type?.ocean || '—' },
    { key: 'river', label: 'River', count: stats?.by_type?.river || '—' },
    { key: 'lake', label: 'Lake', count: stats?.by_type?.lake || '—' },
    { key: 'reservoir', label: 'Reservoir', count: stats?.by_type?.reservoir || '—' },
  ];

  return (
    <div className="page">
      <motion.div className="page-header" {...fadeUp}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--accent-teal-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Compass size={20} style={{ color: 'var(--accent-teal)' }} />
          </div>
          <div>
            <h1 className="page-title">Locations Explorer</h1>
            <p className="page-subtitle">Browse and explore 95K+ DIGIPIN water body locations across India</p>
          </div>
        </div>
      </motion.div>

      {/* Stats */}
      <motion.div className="stats-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }} {...fadeUp} transition={{ delay: 0.1 }}>
        {tabs.map(({ key, label, count }, i) => (
          <motion.div
            key={label}
            className={`glass-card stat-card ${key === activeTab ? 'glass-card--interactive' : ''}`}
            style={{
              cursor: 'pointer',
              borderColor: key === activeTab ? 'var(--accent-blue)' : undefined,
            }}
            {...fadeUp}
            transition={{ delay: 0.1 + i * 0.04 }}
            onClick={() => { setActiveTab(key); setPage(0); }}
          >
            <div className="stat-card-header">
              <span className="stat-card-label">{label}</span>
            </div>
            <div className="stat-card-value" style={{ fontSize: 'var(--text-2xl)' }}>
              {typeof count === 'number' && count > 1000 ? `${(count / 1000).toFixed(1)}K` : count}
            </div>
          </motion.div>
        ))}
      </motion.div>

      {/* Search */}
      <motion.div {...fadeUp} transition={{ delay: 0.2 }} style={{ marginBottom: 'var(--space-5)', maxWidth: '400px' }}>
        <div className="search-bar">
          <Search size={15} />
          <input
            type="text"
            placeholder="Search by name, region, DIGIPIN..."
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
          />
        </div>
      </motion.div>

      {/* Tab bar */}
      <motion.div {...fadeUp} transition={{ delay: 0.25 }}>
        <div className="tab-bar" style={{ maxWidth: '500px' }}>
          {tabs.map(({ key, label }) => (
            <button
              key={label}
              className={`tab-item${key === activeTab ? ' active' : ''}`}
              onClick={() => { setActiveTab(key); setPage(0); }}
            >
              {label}
            </button>
          ))}
        </div>
      </motion.div>

      {/* Table */}
      {isLoading ? (
        <div className="loading-state">
          <div className="spinner" />
          <span>Loading locations...</span>
        </div>
      ) : (
        <motion.div className="glass-card glass-card--no-hover" style={{ padding: 0, overflowX: 'auto' }} {...fadeUp} transition={{ delay: 0.3 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Region</th>
                <th>Type</th>
                <th>DIGIPIN</th>
                <th>Lat</th>
                <th>Lon</th>
                <th>Base Depth</th>
              </tr>
            </thead>
            <tbody>
              {locations.map((loc, i) => (
                <tr key={loc.digipin || i} onClick={() => navigate(`/location/${loc.digipin}`)}>
                  <td style={{ fontWeight: 600 }}>{loc.name}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{loc.region}</td>
                  <td>
                    <span className={`chip ${loc.water_body_type}`}>
                      {loc.water_body_type}
                    </span>
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-tertiary)' }}>
                    {loc.digipin}
                  </td>
                  <td style={{ fontSize: '12px' }}>{loc.latitude?.toFixed(3)}</td>
                  <td style={{ fontSize: '12px' }}>{loc.longitude?.toFixed(3)}</td>
                  <td style={{ fontWeight: 600, color: 'var(--accent-teal)' }}>
                    {loc.base_depth?.toFixed(1)}m
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {locations.length === 0 && (
            <div className="empty-state" style={{ padding: '40px' }}>
              <MapPin size={32} />
              <span>No locations found</span>
            </div>
          )}
        </motion.div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="pagination">
          <button
            className="pagination-btn"
            disabled={page === 0}
            onClick={() => setPage(p => Math.max(0, p - 1))}
          >
            <ChevronLeft size={14} /> Prev
          </button>
          <span className="pagination-info">
            Page {page + 1} of {totalPages} · {total.toLocaleString()} locations
          </span>
          <button
            className="pagination-btn"
            disabled={page >= totalPages - 1}
            onClick={() => setPage(p => p + 1)}
          >
            Next <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
