import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, ShieldCheck, AlertTriangle, AlertOctagon, CloudRain, Waves, Activity, ChevronRight, WifiOff, CheckCircle2, ChevronDown } from 'lucide-react';
import { PageHeader, Card, Segmented, Badge, IconChip, List, EmptyState, fadeUp } from '../components/ui';
import { fmtNum, fmtTime, LEVEL_BADGE, LEVEL_COLOR, TYPE_BADGE } from '../lib/format';
import api from '../services/api';
import './Alerts.css';

const LEVELS = ['critical', 'high', 'moderate', 'low'];
const ICON = { critical: AlertOctagon, high: AlertTriangle, moderate: AlertTriangle, low: Activity, none: CheckCircle2 };
const COLOR = { critical: 'var(--red)', high: 'var(--orange)', moderate: 'var(--yellow)', low: 'var(--blue)', none: 'var(--green)' };
const COMPONENTS = [
  { key: 'rainfall_score', label: 'Rainfall', color: 'var(--blue)' },
  { key: 'discharge_score', label: 'River discharge', color: 'var(--teal)' },
  { key: 'tidal_score', label: 'Tide', color: 'var(--indigo)' },
  { key: 'monsoon_index', label: 'Monsoon', color: 'var(--purple)' },
];

function Ring({ value, color }) {
  const r = 14; const c = 2 * Math.PI * r; const v = Math.max(0, Math.min(1, value || 0));
  return (
    <svg width="38" height="38" viewBox="0 0 38 38" className="al-ring" aria-label={`Risk ${Math.round(v * 100)} percent`}>
      <circle cx="19" cy="19" r={r} fill="none" stroke="var(--fill-3)" strokeWidth="3.5" />
      <circle cx="19" cy="19" r={r} fill="none" stroke={color} strokeWidth="3.5" strokeLinecap="round" strokeDasharray={`${c * v} ${c}`} transform="rotate(-90 19 19)" />
      <text x="19" y="19" textAnchor="middle" dominantBaseline="central" className="al-ring-t">{Math.round(v * 100)}</text>
    </svg>
  );
}

function AlertRow({ a, open, onToggle, onOpen }) {
  const lvl = a.alert_level || 'none';
  const Icon = ICON[lvl] || Activity;
  const comps = a.components || {};
  return (
    <div className="al-item" data-level={lvl}>
      <div className="list-row tappable al-row" role="button" tabIndex={0} aria-expanded={open}
        onClick={onToggle} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onToggle())}>
        <IconChip icon={Icon} color={COLOR[lvl]} />
        <div className="list-main">
          <div className="list-title">{a.name}</div>
          <div className="list-detail al-detail">{[a.region, a.details].filter(Boolean).join(' · ')}</div>
        </div>
        <Ring value={a.risk_score} color={LEVEL_COLOR[lvl]} />
        <span className="al-badge"><Badge tone={LEVEL_BADGE[lvl]}>{lvl === 'none' ? 'Normal' : lvl}</Badge></span>
        <ChevronDown className={`chev al-chev ${open ? 'open' : ''}`} />
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div className="al-more" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}>
            <div className="al-more-inner">
              <div className="al-comps">
                {COMPONENTS.map((c) => (
                  <div key={c.key} className="al-comp">
                    <div className="al-comp-h"><span>{c.label}</span><span className="tnum">{Math.round((comps[c.key] || 0) * 100)}%</span></div>
                    <div className="bar"><i style={{ width: `${Math.round((comps[c.key] || 0) * 100)}%`, background: c.color }} /></div>
                  </div>
                ))}
              </div>
              <div className="al-more-foot">
                <Badge tone={TYPE_BADGE[a.water_body_type] || ''}>{a.water_body_type || 'water body'}</Badge>
                {a.digipin && <span className="mono al-pin">{a.digipin}</span>}
                <button className="btn tinted al-view" onClick={onOpen}>View location <ChevronRight size={15} /></button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Skeletons() {
  return (
    <div role="status" aria-live="polite">
      <div className="al-scan"><span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />Scanning water bodies…</div>
      <List>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="list-row" style={{ minHeight: 60 }}>
            <div className="skeleton" style={{ width: 30, height: 30, borderRadius: 8 }} />
            <div className="list-main"><div className="skeleton" style={{ height: 13, width: `${48 + (i * 9) % 30}%`, marginBottom: 7 }} /><div className="skeleton" style={{ height: 11, width: '70%' }} /></div>
            <div className="skeleton" style={{ width: 38, height: 38, borderRadius: 19 }} />
          </div>
        ))}
      </List>
    </div>
  );
}

export default function Alerts() {
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [updated, setUpdated] = useState(null);
  const [filter, setFilter] = useState('all');
  const [openId, setOpenId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError(false);
    try {
      const r = await api.get('/alerts/active'); // bypass cache: refresh must be real
      setData(r.data); setUpdated(new Date());
    } catch { setError(true); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const alerts = useMemo(() => (data?.alerts || []).slice().sort((a, b) => (b.risk_score || 0) - (a.risk_score || 0)), [data]);
  const active = alerts.filter((a) => a.alert_level && a.alert_level !== 'none');
  const normal = alerts.filter((a) => !a.alert_level || a.alert_level === 'none');
  const counts = useMemo(() => {
    const c = { all: active.length };
    LEVELS.forEach((l) => { c[l] = active.filter((a) => a.alert_level === l).length; });
    return c;
  }, [active]);
  const shown = filter === 'all' ? active : active.filter((a) => a.alert_level === filter);
  const scanned = data?.locations_scanned ?? alerts.length;

  const refresh = (
    <div className="al-refresh">
      {updated && <span className="al-updated tnum">Updated {fmtTime(updated.toISOString())}</span>}
      <button className="btn gray" onClick={load} disabled={loading} aria-label="Refresh alerts">
        <RefreshCw size={16} className={loading ? 'al-spin' : ''} />Refresh
      </button>
    </div>
  );
  const toggle = (id) => setOpenId((o) => (o === id ? null : id));
  const row = (a, i) => (
    <motion.div key={a.digipin || a.name} {...fadeUp} transition={{ ...fadeUp.transition, delay: Math.min(i, 8) * 0.03 }}>
      <AlertRow a={a} open={openId === a.digipin} onToggle={() => toggle(a.digipin)} onOpen={() => nav(`/location/${a.digipin}`)} />
    </motion.div>
  );

  return (
    <div className="page al">
      <PageHeader title="Alerts" subtitle="Flood and surge risk across monitored water bodies, from live rainfall, river discharge and tide data." right={refresh} />

      {error && !data ? (
        <Card><EmptyState icon={WifiOff} title="Couldn’t load alerts" action={<button className="btn" onClick={load}>Try again</button>}>The alert service didn’t respond. Check your connection and retry.</EmptyState></Card>
      ) : !data ? <Skeletons /> : (
        <>
          {error && <Card className="al-banner" role="alert"><AlertTriangle size={16} style={{ color: 'var(--orange)' }} />Refresh failed. Showing the last result.</Card>}
          <div className="al-filter">
            <Segmented label="Filter by level" value={filter} onChange={setFilter} options={[
              { value: 'all', label: `All ${counts.all}` },
              ...LEVELS.map((l) => ({ value: l, label: `${l[0].toUpperCase()}${l.slice(1)} ${counts[l]}` })),
            ]} />
          </div>

          {active.length === 0 ? (
            <Card className="al-clear" data-testid="all-clear">
              <EmptyState icon={ShieldCheck} title="All clear">No active alerts. {fmtNum(scanned)} locations monitored, all within normal range.</EmptyState>
            </Card>
          ) : shown.length === 0 ? (
            <Card><EmptyState icon={ShieldCheck} title={`No ${filter} alerts`}>Nothing at this level right now.</EmptyState></Card>
          ) : (
            <>
              <h2 className="section-title">Active alerts</h2>
              <List>{shown.map(row)}</List>
            </>
          )}

          {normal.length > 0 && filter === 'all' && (
            <>
              <h2 className="section-title">Within normal range <span className="al-count">{normal.length}</span></h2>
              <List>{normal.map((a, i) => row(a, i))}</List>
            </>
          )}
          <p className="al-foot">{fmtNum(data.locations_ok ?? normal.length)} of {fmtNum(scanned)} scanned locations within normal range. Tap a row for the risk breakdown.</p>
        </>
      )}
    </div>
  );
}
