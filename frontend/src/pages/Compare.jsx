import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { GitCompare, X, Download, Plus } from 'lucide-react';
import { PageHeader, Card, CardTitle, Badge, Segmented, ChartTip, EmptyState } from '../components/ui';
import PlaceSearch from '../components/tools/PlaceSearch';
import Ring from '../components/tools/Ring';
import { useWatchlist } from '../lib/watchlist';
import { TYPE_BADGE, LEVEL_BADGE, LEVEL_COLOR } from '../lib/format';
import { placeDetail, depthNow, forecast48, floodNow } from '../services/api_tools';
import { downloadCSV, stamp } from '../lib/export';
import '../components/tools/tools.css';
import './Compare.css';

const COLORS = ['var(--blue)', 'var(--orange)', 'var(--green)', 'var(--purple)'];
const MAX = 4;
const f = (v, d = 2) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(d) : '—');
const sgn = (v, d = 2) => (typeof v === 'number' ? `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}` : '—');

function usePlace(digipin) {
  const [s, setS] = useState({ loading: true });
  useEffect(() => {
    let live = true;
    setS({ loading: true });
    Promise.allSettled([placeDetail(digipin), depthNow(digipin), forecast48(digipin), floodNow(digipin)]).then(([l, d, fc, r]) => {
      if (live) setS({ loading: false, loc: l.value, depth: d.value, fc: fc.value, risk: r.value });
    });
    return () => { live = false; };
  }, [digipin]);
  return s;
}

function Column({ digipin, color, onRemove, report }) {
  const s = usePlace(digipin);
  useEffect(() => { if (!s.loading) report(digipin, s); }, [s]); // eslint-disable-line react-hooks/exhaustive-deps
  const lvl = s.risk?.level || 'none';
  const rows = [
    ['Current depth', s.depth && `${f(s.depth.computed_depth, 1)} m`],
    ['Base depth', s.depth && `${f(s.depth.base_depth, 1)} m`],
    ['Tide', s.depth && `${sgn(s.depth.tidal_offset)} m`],
    ['Rain, 72 h', s.risk && `${f(s.risk.rain_72h_mm, 1)} mm`],
  ];
  return (
    <Card className="cmp-col" aria-label={`Place ${s.loc?.name || digipin}`} data-testid="compare-col">
      <div className="cmp-head">
        <i className="cmp-dot" style={{ background: color }} />
        <div className="cmp-name">
          {s.loading ? <div className="skeleton" style={{ height: 18, width: '70%' }} /> : <Link to={`/location/${digipin}`}>{s.loc?.name || digipin}</Link>}
          <div className="cmp-sub">{s.loc && <Badge tone={TYPE_BADGE[s.loc.water_body_type]}>{s.loc.water_body_type}</Badge>} <span className="mono">{digipin}</span></div>
        </div>
        <button className="wl-x" aria-label={`Remove ${s.loc?.name || digipin} from comparison`} onClick={() => onRemove(digipin)}><X size={15} /></button>
      </div>
      <dl className="cmp-rows">
        {rows.map(([k, v]) => (
          <div key={k}><dt>{k}</dt><dd className="tnum">{s.loading ? <span className="skeleton" style={{ display: 'inline-block', height: 16, width: 56 }} /> : v || '—'}</dd></div>
        ))}
      </dl>
      <div className="cmp-risk">
        {s.loading ? <div className="skeleton" style={{ width: 64, height: 64, borderRadius: 32 }} /> : s.risk ? (
          <>
            <Ring value={s.risk.probability} color={LEVEL_COLOR[lvl]} label={`Flood probability ${Math.round(s.risk.probability * 100)} percent`}>{Math.round(s.risk.probability * 100)}<small style={{ fontSize: 10 }}>%</small></Ring>
            <div><div className="cmp-sub">Flood probability</div><Badge tone={LEVEL_BADGE[lvl]}>{lvl === 'none' ? 'No risk' : `${lvl} risk`}</Badge></div>
          </>
        ) : <div className="cmp-sub">Flood risk unavailable</div>}
      </div>
    </Card>
  );
}

export default function Compare() {
  const [params, setParams] = useSearchParams();
  const ids = useMemo(() => (params.get('ids') || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, MAX), [params]);
  const { items: watch } = useWatchlist();
  const [mode, setMode] = useState('relative');
  const [data, setData] = useState({});

  const setIds = (next) => setParams(next.length ? { ids: next.join(',') } : {}, { replace: true });
  const add = (pin) => { if (!ids.includes(pin) && ids.length < MAX) setIds([...ids, pin]); };
  const remove = (pin) => setIds(ids.filter((x) => x !== pin));
  const report = (pin, s) => setData((p) => (p[pin] === s ? p : { ...p, [pin]: s }));

  const chart = useMemo(() => {
    const rows = Array.from({ length: 49 }, (_, h) => ({ h }));
    ids.forEach((pin) => {
      const s = data[pin];
      if (!s?.fc || !s.depth) return;
      const cur = s.depth.computed_depth;
      rows[0][pin] = mode === 'relative' ? 0 : cur;
      s.fc.forecast.slice(0, 48).forEach((p, i) => { rows[i + 1][pin] = mode === 'relative' ? p.predicted_depth - cur : p.predicted_depth; });
    });
    return rows;
  }, [ids, data, mode]);
  const nameOf = (pin) => data[pin]?.loc?.name || pin;

  const exportCSV = () => {
    const rows = ids.map((p) => ({ p, s: data[p] || {} }));
    downloadCSV(`aquadepth-compare-${stamp()}.csv`, rows, [
      { label: 'Name', get: (x) => x.s.loc?.name }, { label: 'DIGIPIN', get: (x) => x.p }, { label: 'Type', get: (x) => x.s.loc?.water_body_type },
      { label: 'Current depth (m)', get: (x) => x.s.depth?.computed_depth }, { label: 'Base depth (m)', get: (x) => x.s.depth?.base_depth },
      { label: 'Tide offset (m)', get: (x) => x.s.depth?.tidal_offset }, { label: 'Rain 72h (mm)', get: (x) => x.s.risk?.rain_72h_mm },
      { label: 'Flood probability', get: (x) => x.s.risk?.probability }, { label: 'Flood level', get: (x) => x.s.risk?.level },
      { label: 'Forecast +24h (m)', get: (x) => x.s.fc?.forecast?.[23]?.predicted_depth }, { label: 'Forecast +48h (m)', get: (x) => x.s.fc?.forecast?.[47]?.predicted_depth },
    ]);
  };

  const pickable = watch.filter((w) => !ids.includes(w.digipin));
  const haveChart = ids.some((p) => data[p]?.fc);
  const loadingChart = ids.length > 0 && ids.some((p) => !data[p]);

  return (
    <div className="page">
      <PageHeader title="Compare" subtitle="Put two to four places side by side — depth, tide, rain, flood risk and the next 48 hours."
        right={ids.length > 0 && <button className="btn gray" onClick={exportCSV}><Download size={15} />Export CSV</button>} />

      <div className="cmp-add">
        {ids.length < MAX ? <PlaceSearch placeholder={`Add a place (${ids.length}/${MAX})`} exclude={ids} onPick={(it) => add(it.digipin)} /> : <p className="cmp-sub">Maximum of {MAX} places. Remove one to add another.</p>}
        {pickable.length > 0 && ids.length < MAX && (
          <div className="tl-chips" aria-label="Add from watchlist">
            {pickable.slice(0, 8).map((w) => <button key={w.digipin} className="tl-chip" onClick={() => add(w.digipin)}><Plus size={13} style={{ marginRight: 4 }} />{w.name}</button>)}
          </div>
        )}
      </div>

      {ids.length === 0 ? (
        <Card><EmptyState icon={GitCompare} title="Choose places to compare">Search above or pick from your watchlist. The URL updates, so you can share the comparison.</EmptyState></Card>
      ) : (
        <>
          {ids.length === 1 && <p className="cmp-sub" style={{ margin: '0 4px 12px' }}>Add at least one more place to compare.</p>}
          <div className="cmp-grid">{ids.map((p, i) => <Column key={p} digipin={p} color={COLORS[i]} onRemove={remove} report={report} />)}</div>

          <Card className="cmp-chart" aria-label="48 hour forecast comparison">
            <div className="row between wrap" style={{ marginBottom: 12 }}>
              <div><CardTitle icon={GitCompare} color="var(--blue)" sub={mode === 'relative' ? 'Change in depth from now (m), so different depths are comparable' : 'Predicted absolute depth (m)'}>48-hour forecast</CardTitle></div>
              <Segmented label="Chart mode" value={mode} onChange={setMode} options={[{ value: 'relative', label: 'Change' }, { value: 'absolute', label: 'Absolute' }]} />
            </div>
            {loadingChart && !haveChart ? <div className="skeleton" style={{ height: 280 }} /> : !haveChart ? <p className="cmp-sub">Forecast unavailable for these places right now.</p> : (
              <div className="cmp-plot" data-testid="compare-chart">
                <ResponsiveContainer>
                  <LineChart data={chart} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="h" axisLine={false} tickLine={false} tick={{ fontSize: 11 }} tickFormatter={(h) => `+${h}h`} interval={7} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11 }} width={46} domain={['auto', 'auto']} tickFormatter={(v) => (mode === 'relative' ? sgn(v, 1) : v.toFixed(1))} />
                    <Tooltip content={<ChartTip unit=" m" labelFormatter={(h) => `In ${h} h`} />} cursor={{ stroke: 'var(--label-3)' }} />
                    {ids.map((p, i) => data[p]?.fc && <Line key={p} type="monotone" dataKey={p} name={nameOf(p)} stroke={COLORS[i]} strokeWidth={2.25} dot={false} strokeLinecap="round" isAnimationActive={false} />)}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
            <div className="cmp-legend">{ids.map((p, i) => <span key={p}><i style={{ background: COLORS[i] }} />{nameOf(p)}</span>)}</div>
          </Card>
        </>
      )}
    </div>
  );
}
