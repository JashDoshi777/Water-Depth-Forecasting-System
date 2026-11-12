import React, { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Map,
  Waves,
  BarChart3,
  AlertTriangle,
  Droplets,
  Globe,
  Database,
  Compass,
  TrendingUp,
  Layers,
  Radio,
} from 'lucide-react';

const mainNav = [
  { to: '/', icon: Map, label: 'Dashboard' },
  { to: '/forecast', icon: TrendingUp, label: 'Forecast' },
  { to: '/locations', icon: Compass, label: 'Locations' },
  { to: '/analytics', icon: BarChart3, label: 'Analytics' },
  { to: '/alerts', icon: AlertTriangle, label: 'Alerts' },
  { to: '/data-sources', icon: Database, label: 'Data Sources' },
];

export default function Sidebar({ open = false, onClose = () => {} }) {
  const location = useLocation();
  const [online, setOnline] = useState(null);

  useEffect(() => { onClose(); }, [location.pathname]);

  useEffect(() => {
    let alive = true;
    const check = () => fetch('/api/health').then((r) => alive && setOnline(r.ok)).catch(() => alive && setOnline(false));
    check();
    const id = setInterval(check, 30000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const month = new Date().getMonth() + 1;
  const season =
    month >= 6 && month <= 9
      ? 'Monsoon'
      : month >= 10 && month <= 11
      ? 'Post-Monsoon'
      : month >= 3 && month <= 5
      ? 'Pre-Monsoon'
      : 'Winter';

  return (
    <motion.aside
      className={`sidebar${open ? ' open' : ''}`}
      initial={{ x: -260, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
    >
      {/* Logo */}
      <div className="sidebar-logo">
        <div className="sidebar-logo-icon">
          <Droplets size={17} color="#fff" strokeWidth={2.5} />
        </div>
        <span className="sidebar-logo-text">AquaDepth</span>
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav">
        <div className="sidebar-section-label">Navigation</div>
        {mainNav.map(({ to, icon: Icon, label }, index) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `sidebar-link${isActive ? ' active' : ''}`
            }
          >
            <Icon strokeWidth={1.8} />
            <span>{label}</span>
            {label === 'Alerts' && (
              <span className="sidebar-badge live" style={{ fontSize: '8px', padding: '1px 6px' }}>LIVE</span>
            )}
          </NavLink>
        ))}

        <div className="sidebar-divider" />

        <div className="sidebar-section-label">Data Feeds</div>
        {[
          { icon: Globe, label: 'Open-Meteo', status: 'ERA5' },
          { icon: Waves, label: 'StormGlass', status: 'Tidal' },
          { icon: Layers, label: 'GEBCO', status: 'Bathy' },
        ].map(({ icon: Icon, label, status }) => (
          <div key={label} className="sidebar-link" style={{ cursor: 'default', opacity: 0.7 }}>
            <Icon strokeWidth={1.5} />
            <span style={{ flex: 1 }}>{label}</span>
            <span className="sidebar-badge live">{status}</span>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="sidebar-footer">
        <div className="sidebar-footer-info">
          <div className="sidebar-footer-dot" style={online === false ? { background: 'var(--accent-red)', boxShadow: '0 0 8px rgba(255,69,58,0.5)' } : undefined} />
          <div>
            <div className="sidebar-footer-text" style={{ color: 'var(--text-secondary)', fontWeight: 600, fontSize: '11px' }}>
              {online === false ? 'Backend Offline' : online ? 'System Online' : 'Connecting…'}
            </div>
            <div className="sidebar-footer-text">
              {season} · India · v1.0
            </div>
          </div>
        </div>
      </div>
    </motion.aside>
  );
}
