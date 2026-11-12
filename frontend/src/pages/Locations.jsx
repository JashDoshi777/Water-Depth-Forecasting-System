import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, MapPinOff, AlertCircle } from 'lucide-react';
import { getAllLocations, searchLocationsLimit, getLocationStats } from '../services/api';
import { PageHeader, Card, SearchField, Segmented, Badge, List, EmptyState, fadeUp } from '../components/ui';
import { fmtNum, TYPE_BADGE } from '../lib/format';
import './Locations.css';

const PAGE = 50;
const TYPES = ['', 'ocean', 'river', 'lake', 'reservoir'];
const TYPE_LABEL = { '': 'All', ocean: 'Ocean', river: 'River', lake: 'Lake', reservoir: 'Reservoir' };
const Sk = ({ w = '100%' }) => <div className="skeleton lc-sk" style={{ width: w }} />;

export default function Locations() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(0);
  const [stats, setStats] = useState(null);
  const [res, setRes] = useState({ status: 'loading', rows: [], total: 0 });
  const [tries, setTries] = useState(0);
  const seq = useRef(0);
  const searchCache = useRef({ key: '', rows: [], total: 0 });

  useEffect(() => { getLocationStats().then(setStats).catch(() => {}); }, []);

  // debounce search text and reset page
  useEffect(() => {
    const t = setTimeout(() => { setDq(q.trim()); setPage(0); }, 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const id = ++seq.current;
    const ok = (rows, total) => id === seq.current && setRes({ status: 'ok', rows, total });
    const fail = () => id === seq.current && setRes({ status: 'error', rows: [], total: 0 });
    setRes((r) => ({ ...r, status: 'loading' }));
    if (dq) {
      const key = `${dq}|${type}`;
      const c = searchCache.current;
      if (c.key === key) { ok(c.rows.slice(page * PAGE, (page + 1) * PAGE), c.total); return; }
      searchLocationsLimit(dq, type, 500).then((r) => {
        const rows = r.locations || [];
        searchCache.current = { key, rows, total: r.total ?? rows.length };
        ok(rows.slice(page * PAGE, (page + 1) * PAGE), r.total ?? rows.length);
      }).catch(fail);
    } else {
      getAllLocations(PAGE, page * PAGE, type).then((r) => ok(r.locations || [], r.total ?? 0)).catch(fail);
    }
  }, [dq, type, page, tries]);

  const loading = res.status === 'loading';
  const total = res.total;
  const searching = !!dq;
  const capped = searching && total > 500;
  const reachable = capped ? 500 : total;
  const start = total ? page * PAGE + 1 : 0;
  const end = Math.min(page * PAGE + PAGE, reachable);
  const hasNext = (page + 1) * PAGE < reachable;
  const count = (t) => (stats ? (t ? stats.by_type?.[t] : stats.total) : null);
  const go = (loc) => navigate(`/location/${loc.digipin}`);

  const typeOptions = TYPES.map((t) => ({
    value: t,
    label: <>{TYPE_LABEL[t]}{count(t) != null && <span className="lc-seg-count">{fmtNum(count(t))}</span>}</>,
  }));

  const rows = res.rows;
  const showSkeleton = loading && !rows.length;

  return (
    <div className="page">
      <PageHeader title="Locations" subtitle={stats ? `Browse ${fmtNum(stats.total)} monitored water bodies across India.` : 'Browse monitored water bodies across India.'} />

      <div className="lc-controls">
        <div className="lc-search"><SearchField value={q} onChange={setQ} placeholder="Search name, region or city" /></div>
        <div className="lc-seg-scroll"><Segmented label="Water body type" options={typeOptions} value={type} onChange={(v) => { setType(v); setPage(0); }} /></div>
      </div>

      {res.status === 'error' ? (
        <Card><EmptyState icon={AlertCircle} title="Couldn’t load locations"
          action={<button className="btn tinted" onClick={() => setTries((x) => x + 1)}>Retry</button>}>The server took too long or is unavailable.</EmptyState></Card>
      ) : !loading && !rows.length ? (
        <Card><EmptyState icon={MapPinOff} title="No locations found">Try a different name, region or city, or choose another type.</EmptyState></Card>
      ) : (
        <motion.div {...fadeUp} className={loading && rows.length ? 'lc-refresh' : ''}>
          {/* Desktop table */}
          <Card flush className="lc-table-view">
            <div className="table-wrap">
              <table className="table" aria-label="Locations">
                <thead><tr><th>Name</th><th>Region</th><th>Type</th><th>DIGIPIN</th><th className="num">Lat</th><th className="num">Lon</th><th className="num">Base depth</th></tr></thead>
                <tbody>
                  {showSkeleton ? [...Array(10)].map((_, i) => (
                    <tr key={i} style={{ cursor: 'default' }}>{[70, 50, 40, 60, 40, 40, 40].map((w, j) => <td key={j}><Sk w={`${w}%`} /></td>)}</tr>
                  )) : rows.map((l) => (
                    <tr key={l.digipin} onClick={() => go(l)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && go(l)} data-testid="location-row">
                      <td className="lc-name">{l.name}</td>
                      <td style={{ color: 'var(--label-2)' }}>{l.region || '—'}</td>
                      <td><Badge tone={TYPE_BADGE[l.water_body_type]}>{l.water_body_type}</Badge></td>
                      <td className="mono">{l.digipin}</td>
                      <td className="num tnum">{Number(l.latitude).toFixed(3)}</td>
                      <td className="num tnum">{Number(l.longitude).toFixed(3)}</td>
                      <td className="num tnum">{l.base_depth != null ? `${Number(l.base_depth).toFixed(1)} m` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Mobile grouped list */}
          <List className="lc-list-view" aria-label="Locations list">
            {showSkeleton ? [...Array(8)].map((_, i) => (
              <div key={i} className="list-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}><Sk w="55%" /><Sk w="80%" /></div>
            )) : rows.map((l) => (
              <button key={l.digipin} className="list-row" onClick={() => go(l)} data-testid="location-row">
                <div className="list-main">
                  <div className="list-title">{l.name}</div>
                  <div className="list-detail">{l.region || '—'} · <span className="mono">{l.digipin}</span></div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <Badge tone={TYPE_BADGE[l.water_body_type]}>{l.water_body_type}</Badge>
                  <div className="list-detail tnum" style={{ marginTop: 3 }}>{l.base_depth != null ? `${Number(l.base_depth).toFixed(1)} m` : '—'}</div>
                </div>
                <ChevronRight className="chev" />
              </button>
            ))}
          </List>

          <div className="lc-foot">
            <span className="tnum" aria-live="polite">{total ? `${fmtNum(start)}–${fmtNum(end)} of ${fmtNum(total)}` : loading ? 'Loading…' : ''}</span>
            <div className="lc-pager">
              <button className="btn gray" disabled={page === 0 || loading} onClick={() => setPage((p) => p - 1)}><ChevronLeft size={16} />Previous</button>
              <button className="btn gray" disabled={!hasNext || loading} onClick={() => setPage((p) => p + 1)}>Next<ChevronRight size={16} /></button>
            </div>
          </div>
          {capped && <p className="lc-note">Showing the 500 closest matches. Refine your search to narrow results.</p>}
        </motion.div>
      )}
    </div>
  );
}
