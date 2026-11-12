import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { TrendingUp, TrendingDown, Minus, ArrowUpDown, Waves, Activity, Search, AlertCircle, MapPin, ChevronRight } from 'lucide-react';
import { searchLocations, getDepthForecast } from '../services/api';
import { PageHeader, Card, CardTitle, Stat, Segmented, SearchField, Badge, List, ListRow, EmptyState, ChartTip, fadeUp } from '../components/ui';
import { TYPE_BADGE } from '../lib/format';
import './Forecast.css';

const CITIES = ['Mumbai', 'Chennai', 'Kochi', 'Kolkata', 'Visakhapatnam', 'Varanasi'];
const HORIZONS = [{ value: 6, label: '6 h' }, { value: 12, label: '12 h' }, { value: 24, label: '24 h' }, { value: 48, label: '48 h' }];
const n = (v, d = 2) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(d) : '—');
const hh = (iso) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', hour12: true });
const dayHour = (iso) => new Date(iso).toLocaleString('en-IN', { weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
const axisProps = { axisLine: false, tickLine: false, tick: { fontSize: 11 } };
const Sk = ({ h = 16, w = '100%', style }) => <div className="skeleton" style={{ height: h, width: w, ...style }} />;

export default function Forecast() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [suggest, setSuggest] = useState({ loading: false, items: [], q: '' });
  const [sel, setSel] = useState(null);
  const [horizon, setHorizon] = useState(24);
  const [fc, setFc] = useState({ status: 'idle', data: null });
  const [tries, setTries] = useState(0);
  const searchSeq = useRef(0);

  // Debounced suggestions; out-of-order responses ignored.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setSuggest({ loading: false, items: [], q: term }); return; }
    const id = ++searchSeq.current;
    setSuggest((s) => ({ ...s, loading: true }));
    const t = setTimeout(() => {
      searchLocations(term).then((r) => {
        if (id === searchSeq.current) setSuggest({ loading: false, items: (r.locations || []).slice(0, 8), q: term });
      }).catch(() => { if (id === searchSeq.current) setSuggest({ loading: false, items: [], q: term, error: true }); });
    }, 280);
    return () => clearTimeout(t);
  }, [q]);

  // Forecast for the selected location; stale data cleared immediately.
  useEffect(() => {
    if (!sel) return;
    let live = true;
    setFc({ status: 'loading', data: null });
    getDepthForecast({ digipin: sel.digipin, hours_ahead: 48 }).then(
      (d) => live && setFc({ status: 'ok', data: d }),
      () => live && setFc({ status: 'error', data: null }),
    );
    return () => { live = false; };
  }, [sel, tries]);

  const pick = useCallback((loc) => { setSel(loc); setQ(''); setSuggest({ loading: false, items: [], q: '' }); }, []);
  const pickCity = useCallback(async (city) => {
    setQ(''); setSel(null); setFc({ status: 'loading', data: null });
    try {
      const r = await searchLocations(city);
      if (r.locations?.[0]) setSel(r.locations[0]); else setFc({ status: 'error', data: null });
    } catch { setFc({ status: 'error', data: null }); }
  }, []);

  const rows = useMemo(() => (fc.data?.forecast || []).slice(0, horizon).map((f) => ({
    t: f.timestamp, depth: f.predicted_depth, band: [f.confidence_low, f.confidence_high],
    tide: f.tidal_component, rain: f.rainfall_component, low: f.confidence_low, high: f.confidence_high,
  })), [fc.data, horizon]);

  const stats = useMemo(() => {
    if (!rows.length) return null;
    const ds = rows.map((r) => r.depth);
    const min = Math.min(...ds), max = Math.max(...ds);
    let hi = null;
    for (let i = 1; i < rows.length - 1; i++) if (rows[i].tide >= rows[i - 1].tide && rows[i].tide > rows[i + 1].tide) { hi = rows[i]; break; }
    const delta = ds[ds.length - 1] - ds[0];
    return { min, max, range: max - min, hi, delta };
  }, [rows]);
  const domain = useMemo(() => {
    if (!rows.length) return ['auto', 'auto'];
    const lo = Math.min(...rows.map((r) => r.low)), hi = Math.max(...rows.map((r) => r.high));
    const pad = Math.max((hi - lo) * 0.2, 0.05);
    return [lo - pad, hi + pad];
  }, [rows]);

  const showSuggest = q.trim().length >= 2;
  const trend = stats && (Math.abs(stats.delta) < 0.02 ? ['Steady', Minus, 'var(--label-2)'] : stats.delta > 0 ? ['Rising', TrendingUp, 'var(--orange)'] : ['Falling', TrendingDown, 'var(--teal)']);

  return (
    <div className="page">
      <PageHeader title="Forecast" subtitle="Hour-by-hour depth predictions with confidence ranges for any water body." />

      <div className="fc-search">
        <SearchField value={q} onChange={setQ} placeholder="Search a city, river or coast" />
        <AnimatePresence>
          {showSuggest && (
            <motion.div className="list fc-sugg" role="listbox" aria-label="Suggestions" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              {suggest.loading && !suggest.items.length ? (
                [0, 1, 2].map((i) => <div key={i} className="list-row"><Sk h={14} w={`${60 - i * 10}%`} /></div>)
              ) : suggest.items.length ? suggest.items.map((l) => (
                <ListRow key={l.digipin} onClick={() => pick(l)} role="option"
                  title={l.name} detail={`${l.region} · ${l.digipin}`}>
                  <Badge tone={TYPE_BADGE[l.water_body_type]}>{l.water_body_type}</Badge>
                </ListRow>
              )) : <div className="list-row"><span className="list-detail">{suggest.error ? 'Search failed. Try again.' : `No results for “${q.trim()}”.`}</span></div>}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="fc-chips" role="group" aria-label="Quick picks">
        {CITIES.map((c) => <button key={c} className="fc-chip" onClick={() => pickCity(c)}>{c}</button>)}
      </div>

      {!sel && fc.status !== 'loading' && fc.status !== 'error' && (
        <motion.div {...fadeUp}>
          <Card style={{ marginTop: 28 }}>
            <EmptyState icon={Activity} title="Pick a place to forecast">
              Search above or tap a city to see the next 48 hours of predicted water depth, tide influence and confidence.
            </EmptyState>
          </Card>
        </motion.div>
      )}

      {(sel || fc.status === 'loading' || fc.status === 'error') && (
        <>
          <div className="fc-sel">
            <div>
              {sel ? (
                <>
                  <h2 data-testid="selected-name">{sel.name}</h2>
                  <div className="fc-sel-sub">
                    <Badge tone={TYPE_BADGE[sel.water_body_type]}>{sel.water_body_type}</Badge>
                    <span>{sel.region}</span><span className="mono">{sel.digipin}</span>
                    <button className="fc-link" onClick={() => navigate(`/location/${sel.digipin}`)}>Details <ChevronRight size={13} style={{ verticalAlign: -2 }} /></button>
                  </div>
                </>
              ) : <><Sk h={26} w={200} /><Sk h={18} w={260} style={{ marginTop: 10 }} /></>}
            </div>
            <Segmented label="Forecast horizon" options={HORIZONS} value={horizon} onChange={setHorizon} />
          </div>

          {fc.status === 'error' ? (
            <Card><EmptyState icon={AlertCircle} title="Couldn’t load the forecast"
              action={<button className="btn tinted" onClick={() => (sel ? setTries((x) => x + 1) : null)} disabled={!sel}>Retry</button>}>
              The forecast service didn’t respond. Please try again.</EmptyState></Card>
          ) : (
            <>
              <Card aria-label="Forecast chart">
                <CardTitle icon={Activity} color="var(--blue)" sub={`Predicted depth for the next ${horizon} hours`}>Depth forecast</CardTitle>
                {fc.status === 'loading' ? <Sk h={300} /> : (
                  <>
                    <div className="fc-chart">
                      <ResponsiveContainer>
                        <ComposedChart data={rows} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
                          <defs>
                            <linearGradient id="fcg" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="var(--blue)" stopOpacity={0.26} /><stop offset="100%" stopColor="var(--blue)" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid vertical={false} />
                          <XAxis dataKey="t" {...axisProps} tickFormatter={hh} minTickGap={40} />
                          <YAxis yAxisId="l" {...axisProps} width={44} domain={domain} tickFormatter={(v) => v.toFixed(1)} />
                          <YAxis yAxisId="r" orientation="right" {...axisProps} width={40} domain={['auto', 'auto']} tickFormatter={(v) => v.toFixed(1)} />
                          <Tooltip content={<ChartTip unit=" m" labelFormatter={dayHour} />} cursor={{ stroke: 'var(--label-3)' }} />
                          <Area yAxisId="l" type="monotone" dataKey="band" name="Range" stroke="none" fill="var(--blue)" fillOpacity={0.14} isAnimationActive={false} activeDot={false} />
                          <Area yAxisId="l" type="monotone" dataKey="depth" name="Depth" stroke="var(--blue)" strokeWidth={2.25} fill="url(#fcg)" dot={false} activeDot={{ r: 4, fill: 'var(--blue)', stroke: 'var(--bg-elevated)', strokeWidth: 2 }} />
                          <Line yAxisId="r" type="monotone" dataKey="tide" name="Tide component" stroke="var(--teal)" strokeWidth={1.75} strokeDasharray="4 4" dot={false} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="fc-legend">
                      <span><i style={{ background: 'var(--blue)' }} />Depth (left)</span>
                      <span><i className="band" style={{ background: 'var(--blue)' }} />Confidence range</span>
                      <span><i style={{ background: 'var(--teal)' }} />Tide component (right)</span>
                    </div>
                  </>
                )}
              </Card>

              <div className="grid auto fc-tiles" aria-label="Summary">
                <Stat label="Minimum" icon={TrendingDown} color="var(--teal)" loading={!stats} value={n(stats?.min)} unit="m" foot="Lowest in range" />
                <Stat label="Maximum" icon={TrendingUp} color="var(--orange)" loading={!stats} value={n(stats?.max)} unit="m" foot="Highest in range" />
                <Stat label="Range" icon={ArrowUpDown} color="var(--indigo)" loading={!stats} value={n(stats?.range)} unit="m" foot={`Over ${horizon} hours`} />
                <Stat label="Next high tide" icon={Waves} color="var(--blue)" loading={!stats}
                  value={stats?.hi ? hh(stats.hi.t) : '—'} foot={stats?.hi ? `Tide ${n(stats.hi.tide)} m` : 'None in this window'} />
                <Stat label="Trend" icon={trend ? trend[1] : Minus} color={trend ? trend[2] : undefined} loading={!stats}
                  value={trend ? trend[0] : '—'} foot={stats ? `${stats.delta >= 0 ? '+' : '−'}${Math.abs(stats.delta).toFixed(2)} m over ${horizon} h` : ''} />
              </div>

              <div className="section-title">Hourly</div>
              <Card flush>
                <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
                  <table className="table" aria-label="Hourly forecast">
                    <thead><tr><th>Time</th><th>Depth (m)</th><th>Low</th><th>High</th><th>Tide (m)</th></tr></thead>
                    <tbody>
                      {fc.status === 'loading' ? [...Array(6)].map((_, i) => <tr key={i}><td colSpan={5}><Sk h={14} /></td></tr>) :
                        rows.map((r) => (
                          <tr key={r.t} style={{ cursor: 'default' }}>
                            <td>{dayHour(r.t)}</td><td className="tnum"><b>{n(r.depth)}</b></td>
                            <td className="tnum">{n(r.low)}</td><td className="tnum">{n(r.high)}</td><td className="tnum">{n(r.tide)}</td>
                          </tr>))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}
