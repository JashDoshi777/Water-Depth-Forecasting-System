import React, { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, BarChart, Bar, Legend } from 'recharts';
import { BrainCircuit, Gauge, Cpu, Waves, TrendingUp, AlertTriangle, CheckCircle2, XCircle, Layers, RefreshCw } from 'lucide-react';
import { PageHeader, Card, CardTitle, Stat, Badge, IconChip, ChartTip, fadeUp, Loading, EmptyState } from '../components/ui';
import { getMLOverview, mlForecast, mlFlood, mlStaticDepth, encodeDIGIPIN } from '../services/api';
import { fmtNum } from '../lib/format';
import './MLLab.css';

const PLACES = [
  { name: 'Mumbai coast', lat: 19.07, lon: 72.8 },
  { name: 'Kochi coast', lat: 9.95, lon: 76.22 },
  { name: 'Sundarbans', lat: 21.7, lon: 88.6 },
  { name: 'Godavari', lat: 17.0, lon: 81.8 },
  { name: 'Brahmaputra', lat: 26.2, lon: 91.75 },
  { name: 'Chilika Lake', lat: 19.7, lon: 85.3 },
];

const m3 = (v, d = 2) => (v == null ? '—' : Number(v).toFixed(d));

function Target({ met, label }) {
  return (
    <div className="ml-target">
      {met ? <CheckCircle2 size={16} style={{ color: 'var(--green)' }} /> : <XCircle size={16} style={{ color: 'var(--orange)' }} />}
      <span style={{ color: 'var(--label-2)' }}>Brief target: {label}</span>
      <Badge tone={met ? 'green' : 'orange'}>{met ? 'Met' : 'Not met'}</Badge>
    </div>
  );
}

function Ring({ value, color }) {
  const r = 56, c = 2 * Math.PI * r, pct = Math.min(1, Math.max(0, value));
  return (
    <svg viewBox="0 0 132 132" width="132" height="132" role="img" aria-label={`${(value * 100).toFixed(1)} percent`}>
      <circle cx="66" cy="66" r={r} fill="none" stroke="var(--fill-3)" strokeWidth="11" />
      <motion.circle cx="66" cy="66" r={r} fill="none" stroke={color} strokeWidth="11" strokeLinecap="round" transform="rotate(-90 66 66)"
        strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - Math.max(pct, 0.015)) }} transition={{ duration: 0.9, ease: [0.32, 0.72, 0, 1] }} />
    </svg>
  );
}

export default function MLLab() {
  const [ov, setOv] = useState(null);
  const [err, setErr] = useState(null);
  const [place, setPlace] = useState(PLACES[0]);
  const [demo, setDemo] = useState({ loading: true });

  useEffect(() => { getMLOverview().then(setOv).catch((e) => setErr(e?.response?.data?.detail || 'ML report unavailable')); }, []);

  const run = useCallback(async (p) => {
    setDemo({ loading: true });
    try {
      const { digipin } = await encodeDIGIPIN(p.lat, p.lon);
      const [f, fl, st] = await Promise.allSettled([mlForecast({ digipin }), mlFlood({ digipin }), mlStaticDepth({ digipin })]);
      setDemo({ digipin, forecast: f.value, flood: fl.value, stat: st.value,
        error: f.status === 'rejected' ? (f.reason?.response?.data?.detail || 'Forecast unavailable') : null });
    } catch { setDemo({ error: 'Could not reach the ML service' }); }
  }, []);
  useEffect(() => { run(place); }, [place, run]);

  if (err) return <div className="page ml"><PageHeader title="ML Lab" /><EmptyState icon={BrainCircuit} title="Models not available">{err}. Run <span className="mono">python -m app.ml.train</span> in backend/.</EmptyState></div>;
  if (!ov) return <div className="page ml"><PageHeader title="ML Lab" /><Loading label="Loading model report…" /></div>;

  const M = ov.metrics, R = ov.runtime, S = M.static_depth, F = M.forecast, L = M.flood;
  const seen = F.mae_m_by_horizon.seen;
  const bars = ['1–6 h', '7–24 h', '25–48 h'].map((k) => ({ h: k, ML: seen[k].ml, Persistence: seen[k].persist, 'Same time yesterday': seen[k].analog }));
  const chart = (demo.forecast?.forecast || []).map((p, i) => ({
    t: new Date(p.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }) + (i % 24 === 0 ? '' : ''),
    depth: p.predicted_depth, band: [p.confidence_low, p.confidence_high], low: p.confidence_low, high: p.confidence_high,
  }));
  const fl = demo.flood;

  return (
    <div className="page ml">
      <PageHeader title="ML Lab" subtitle="Three models behind AquaDepth, trained on real data and evaluated on held-out data. Every number below is measured, including the ones that miss the project targets." />

      <div className="grid c4 ml-tiles" data-testid="ml-tiles">
        <Stat label="48 h forecast latency" icon={Gauge} color="var(--green)" value={R ? R.forecast_48h_p50_ms : '—'} unit=" ms" foot={R ? `p95 ${R.forecast_48h_p95_ms} ms · target < ${R.target_ms} ms` : ''} />
        <Stat label="Model size" icon={Layers} color="var(--blue)" value={R ? R.model_size_mb : '—'} unit=" MB" foot={R ? `process ${fmtNum(R.process_rss_mb)} MB · target < 5 GB` : ''} />
        <Stat label="Forecast training rows" icon={Cpu} color="var(--purple)" value={fmtNum(F.n_train)} foot={`${F.n_features} features · 3 years hourly`} />
        <Stat label="Last trained" icon={RefreshCw} color="var(--teal)" value={new Date(M.generated_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} foot={`${Math.round(M.train_seconds)} s on CPU`} />
      </div>

      <div className="section-title">Models</div>
      <div className="grid c3">
        <Card className="ml-model" data-testid="model-static">
          <div className="ml-model-head"><IconChip lg icon={Layers} color="var(--indigo)" /><div><h3>Static depth</h3><div className="ml-algo">{S.algorithm}</div></div></div>
          <div className="ml-kv">
            <div><b>{m3(S.spatial_block_test.mae_shelf_lt200m, 1)} m</b><span>Shelf MAE (&lt;200 m), unseen regions</span></div>
            <div><b>{m3(S.spatial_block_test.rel_err_pct, 1)}%</b><span>Median relative error</span></div>
            <div><b>{m3(S.baseline_shelf_heuristic_spatial_test.mae_shelf_lt200m, 1)} m</b><span>Old heuristic, same area</span></div>
          </div>
          <Target met={S.target_met} label={S.target} />
          <p className="ml-note">{S.data} {S.note}</p>
        </Card>
        <Card className="ml-model" data-testid="model-forecast">
          <div className="ml-model-head"><IconChip lg icon={TrendingUp} color="var(--blue)" /><div><h3>Depth forecast</h3><div className="ml-algo">{F.algorithm}</div></div></div>
          <div className="ml-kv">
            <div><b>{m3(seen['1–6 h'].ml, 3)} m</b><span>MAE, 1–6 h ahead</span></div>
            <div><b>{m3(seen['25–48 h'].ml, 3)} m</b><span>MAE, 25–48 h ahead</span></div>
            <div><b>{m3(F.tide_phase_error_min.median, 0)} min</b><span>Median tide-timing error</span></div>
            <div><b>{(seen.interval_coverage_80pct * 100).toFixed(0)}%</b><span>P10–P90 band coverage</span></div>
          </div>
          <Target met={F.target_met} label={F.target} />
          <p className="ml-note">{F.data} {F.note}</p>
        </Card>
        <Card className="ml-model" data-testid="model-flood">
          <div className="ml-model-head"><IconChip lg icon={AlertTriangle} color="var(--orange)" /><div><h3>Flood warning</h3><div className="ml-algo">{L.algorithm}</div></div></div>
          <div className="ml-kv">
            <div><b>{(L.precision * 100).toFixed(0)}%</b><span>Precision</span></div>
            <div><b>{(L.recall * 100).toFixed(0)}%</b><span>Recall</span></div>
            <div><b>{m3(L.f1)}</b><span>F1 · PR-AUC {m3(L.pr_auc)}</span></div>
            <div><b>{(L.base_rate_test * 100).toFixed(1)}%</b><span>Event base rate</span></div>
          </div>
          <Target met={L.target_met} label={L.target} />
          <p className="ml-note">{L.label}. {L.note}</p>
        </Card>
      </div>

      <div className="section-title">Does it beat simple baselines?</div>
      <Card>
        <CardTitle icon={TrendingUp} sub="Mean absolute error of the change in depth, on held-out months (May–Nov 2026) at sites seen in training. Lower is better.">Forecast error by horizon</CardTitle>
        <div style={{ height: 250 }} role="img" aria-label="Forecast error by horizon, ML versus baselines">
          <ResponsiveContainer>
            <BarChart data={bars} barCategoryGap="28%">
              <CartesianGrid vertical={false} /><XAxis dataKey="h" axisLine={false} tickLine={false} />
              <YAxis axisLine={false} tickLine={false} unit=" m" width={52} />
              <Tooltip content={<ChartTip unit=" m" digits={3} />} cursor={{ fill: 'var(--fill-3)' }} />
              <Legend iconType="circle" />
              <Bar dataKey="ML" fill="var(--blue)" radius={[6, 6, 0, 0]} />
              <Bar dataKey="Same time yesterday" fill="var(--teal)" radius={[6, 6, 0, 0]} />
              <Bar dataKey="Persistence" fill="var(--fill)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="section-title">Live demo</div>
      <div className="ml-demo-head" role="tablist" aria-label="Demo location">
        {PLACES.map((p) => <button key={p.name} role="tab" aria-selected={place.name === p.name} className={`ml-chip ${place.name === p.name ? 'active' : ''}`} onClick={() => setPlace(p)}>{p.name}</button>)}
      </div>
      <div className="grid c2">
        <Card data-testid="demo-forecast">
          <CardTitle icon={Waves} sub={demo.forecast ? `Next 48 h from ${new Date(demo.forecast.origin).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${demo.forecast.inference_ms} ms model time` : ' '}>Depth forecast with 80% band</CardTitle>
          {demo.loading ? <div className="skeleton" style={{ height: 230 }} /> : demo.error ? <EmptyState icon={AlertTriangle} title="Forecast unavailable">{demo.error}</EmptyState> : (
            <div style={{ height: 230 }}>
              <ResponsiveContainer>
                <ComposedChart data={chart}>
                  <CartesianGrid vertical={false} /><XAxis dataKey="t" axisLine={false} tickLine={false} interval={7} />
                  <YAxis axisLine={false} tickLine={false} domain={['auto', 'auto']} unit=" m" width={56} tickFormatter={(v) => v.toFixed(1)} />
                  <Tooltip content={<ChartTip unit=" m" />} />
                  <Area type="monotone" dataKey="band" stroke="none" fill="var(--blue)" fillOpacity={0.14} name="P10–P90" isAnimationActive={false} />
                  <Line type="monotone" dataKey="depth" name="Depth" stroke="var(--blue)" strokeWidth={2.5} dot={false} strokeLinecap="round" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
        <div className="grid c2" style={{ alignContent: 'start' }}>
          <Card data-testid="demo-flood">
            <CardTitle icon={AlertTriangle} color="var(--orange)" sub="Next 24–48 h">Flood probability</CardTitle>
            {demo.loading ? <div className="skeleton" style={{ height: 132 }} /> : fl ? (
              <>
                <div className="ml-gauge"><Ring value={Math.min(1, fl.probability / Math.max(fl.threshold * 3, 0.05))} color={fl.warning ? 'var(--orange)' : 'var(--green)'} />
                  <div><b>{(fl.probability * 100).toFixed(1)}%</b><span>± {(fl.uncertainty * 100).toFixed(1)}</span></div></div>
                <div className="row between" style={{ marginTop: 12 }}><Badge tone={fl.warning ? 'orange' : 'green'}>{fl.warning ? 'Warning' : 'No warning'}</Badge><span className="stat-foot">Rain 72 h: {fl.rain_72h_mm} mm</span></div>
              </>
            ) : <p className="ml-note">Unavailable</p>}
          </Card>
          <Card data-testid="demo-static">
            <CardTitle icon={Layers} color="var(--indigo)" sub="Where bathymetry is sparse">Static depth model</CardTitle>
            {demo.loading ? <div className="skeleton" style={{ height: 90 }} /> : demo.stat ? (
              <div className="stack" style={{ gap: 8 }}>
                <div className="stat-value">{demo.stat.predicted_depth_m}<small> m</small></div>
                <div className="stat-foot">ML prediction · {demo.stat.is_ocean ? `ETOPO reference ${demo.stat.reference_depth_m} m` : 'inland point, no ocean reference'}</div>
                <div className="stat-foot">Shore distance {demo.stat.shore_distance_km} km</div>
              </div>
            ) : <p className="ml-note">Unavailable</p>}
          </Card>
        </div>
      </div>

      <div className="section-title">Architecture</div>
      <Card>
        <ol className="ml-arch">
          <li><div>Geo-encoder<small>DIGIPIN → lat/lon → real ETOPO bathymetry, geodesic shore distance (pyproj.Geod), seabed slope, river proximity.</small></div></li>
          <li><div>Temporal encoder<small>Sea-level lags (0–48 h), principal tide constituents M2·S2·K1·O1 and the spring–neap beat, so neap/spring non-linearity is learned.</small></div></li>
          <li><div>Weather & hydrology features<small>Rainfall windows (1 h–14 d), monsoon index, GloFAS discharge anomaly, NWP rainfall for the horizon.</small></div></li>
          <li><div>Fusion & decoder<small>Gradient-boosted trees predict the change in depth per horizon (plus P10/P90).</small></div></li>
          <li><div>Physics constraints<small>Depth is clipped to 0.1 m … 1.5 × base + 3 m, and the target is the residual over the hydrodynamic baseline ΔDepth = α·Rain + β·ΔDischarge + Tide − δ·Evap.</small></div></li>
        </ol>
      </Card>
    </div>
  );
}
