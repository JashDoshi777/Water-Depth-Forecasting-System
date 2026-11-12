import React, { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Map, TrendingUp, Compass, BarChart3, AlertTriangle, Database, Droplets, BrainCircuit, MoreHorizontal, Sun, Moon, Monitor, Star, GitCompare, LifeBuoy, ShieldCheck, Code } from 'lucide-react';
import { Segmented, Sheet, List, ListRow } from './ui';
import { useNavigate } from 'react-router-dom';

export const NAV = [
  { to: '/', icon: Map, label: 'Map', tab: true, group: 'Explore' },
  { to: '/forecast', icon: TrendingUp, label: 'Forecast', tab: true, group: 'Explore' },
  { to: '/alerts', icon: AlertTriangle, label: 'Alerts', tab: true, group: 'Explore' },
  { to: '/analytics', icon: BarChart3, label: 'Insights', tab: true, group: 'Explore' },
  { to: '/locations', icon: Compass, label: 'Locations', group: 'Explore' },
  { to: '/watchlist', icon: Star, label: 'Watchlist', group: 'Tools' },
  { to: '/compare', icon: GitCompare, label: 'Compare', group: 'Tools' },
  { to: '/safety', icon: LifeBuoy, label: 'Safety', group: 'Tools' },
  { to: '/ml-lab', icon: BrainCircuit, label: 'ML Lab', group: 'System' },
  { to: '/validation', icon: ShieldCheck, label: 'Validation', group: 'System' },
  { to: '/data-sources', icon: Database, label: 'Data Sources', group: 'System' },
  { to: '/developers', icon: Code, label: 'Developers', group: 'System' },
];

const THEMES = [
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'Auto' },
  { value: 'dark', label: 'Dark' },
];

export function useBackendStatus() {
  const [online, setOnline] = useState(null);
  useEffect(() => {
    let alive = true;
    const check = () => fetch('/api/health').then((r) => alive && setOnline(r.ok)).catch(() => alive && setOnline(false));
    check();
    const id = setInterval(check, 30000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  return online;
}

export default function Sidebar({ theme }) {
  const online = useBackendStatus();
  return (
    <aside className="sidebar" aria-label="Main navigation">
      <div className="brand">
        <Droplets size={18} strokeWidth={2.2} />
        <span className="brand-name">AquaDepth</span>
      </div>
      {['Explore', 'Tools', 'System'].map((g) => (
        <React.Fragment key={g}>
          <div className="sidebar-label">{g}</div>
          {NAV.filter((n) => n.group === g).map(({ to, icon: Icon, label }) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
              <Icon />{label}
            </NavLink>
          ))}
        </React.Fragment>
      ))}
      <div className="sidebar-spacer" />
      <div className="theme-switch">
        <Segmented full label="Appearance" options={THEMES} value={theme.mode} onChange={theme.setMode} />
      </div>
      <div className="sidebar-status" data-testid="backend-status">
        <span className={`dot ${online === false ? 'off' : online ? '' : 'wait'}`} />
        {online === false ? 'Backend offline' : online ? 'All systems online' : 'Connecting…'}
      </div>
    </aside>
  );
}

export function TabBar({ theme }) {
  const [more, setMore] = useState(false);
  const loc = useLocation();
  const nav = useNavigate();
  useEffect(() => setMore(false), [loc.pathname]);
  const moreActive = NAV.filter((n) => !n.tab).some((n) => loc.pathname.startsWith(n.to));
  return (
    <>
      <nav className="tabbar" aria-label="Tab bar">
        {NAV.filter((n) => n.tab).map(({ to, icon: Icon, label }) => (
          <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `tab${isActive ? ' active' : ''}`}>
            <Icon />{label}
          </NavLink>
        ))}
        <button className={`tab${moreActive ? ' active' : ''}`} onClick={() => setMore(true)} aria-label="More"><MoreHorizontal />More</button>
      </nav>
      <Sheet open={more} onClose={() => setMore(false)} title="More">
        <List>
          {NAV.filter((n) => !n.tab).map(({ to, icon, label }) => (
            <ListRow key={to} icon={icon} iconColor="var(--blue)" title={label} onClick={() => nav(to)} />
          ))}
        </List>
        <div className="section-title" style={{ marginTop: 20 }}>Appearance</div>
        <Segmented full label="Appearance" options={THEMES} value={theme.mode} onChange={theme.setMode} />
      </Sheet>
    </>
  );
}
