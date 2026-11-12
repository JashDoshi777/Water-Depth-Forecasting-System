import React, { useEffect, useMemo, useState } from 'react';
import { ResponsiveContainer, ComposedChart, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, BarChart, Bar, ReferenceLine, Legend, Cell } from 'recharts';
import { ShieldCheck, Activity, Clock, Radio, Waves, Wind, AlertTriangle, CheckCircle2, MinusCircle } from 'lucide-react';
import { PageHeader, Card, CardTitle, Stat, Badge, Segmented, ChartTip, EmptyState } from '../components/ui';
import { getValidationSummary, getValidationStations, getValidationStation, getValidationEvents, getValidationEvent } from '../services/api_ml';
import './Validation.css';

const f = (v, d = 2) => (v == null || Number.isNaN(Number(v)) ? '—' : Number(v).toFixed(d));
const day = (iso) => new Date(iso.length === 13 ? iso + ':00Z' : iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' });
const dayShort = (iso) => new Date(iso.length === 13 ? iso + ':00Z' : iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const errMsg = (e) => e?.response?.data?.detail || 'Validation results unavailable';

function Skel({ h = 260 }) { return <div className="skeleton" style={{ height: h }} />; }

function TrackMap({ ev }) {
  const pts = ev.track;
  const lons = [...pts.map((p) => p.lon), ev.station_lon], lats = [...pts.map((p) => p.lat), ev.station_lat];
  const pad = 1.5, x0 = Math.min(...lons) - pad, x1 = Math.max(...lons) + pad, y0 = Math.min(...lats) - pad, y1 = Math.max(...lats) + pad;
  const W = 300, H = Math.max(120, Math.min(240, 300 * (y1 - y0) / (x1 - x0)));
  const X = (lon) => ((lon - x0) / (x1 - x0)) * W, Y = (lat) => H - ((lat - y0) / (y1 - y0)) * H;
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.lon).toFixed(1)},${Y(p.lat).toFixed(1)}`).join(' ');
  const rkm = 500 / 111;                       // 500 km ring (lat-degrees → px)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="val-track" role="img" aria-label={`Storm track of ${ev.storm} relative to the ${ev.station_name} gauge`}>
      <rect width={W} height={H} rx="14" fill="var(--bg-inset)" />
      <circle cx={X(ev.station_lon)} cy={Y(ev.station_lat)} r={(rkm / (y1 - y0)) * H} fill="none" stroke="var(--label-3)" strokeDasharray="3 4" />
      <path d={d} fill="none" stroke="var(--orange)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {pts.map((p, i) => <circle key={i} cx={X(p.lon)} cy={Y(p.lat)} r={2 + Math.min(3, (p.wind_kt || 0) / 30)} fill="var(--orange)" opacity="0.85" />)}
      <circle cx={X(ev.station_lon)} cy={Y(ev.station_lat)} r="5" fill="var(--blue)" stroke="var(--bg-elevated)" strokeWidth="2" />
    </svg>
  );
}

export default function Validation() {
  const [sum, setSum] = useState(null), [sumErr, setSumErr] = useState(null);
  const [stations, setStations] = useState(null);
  const [sid, setSid] = useState('colombo');
  const [days, setDays] = useState(30);
  const [series, setSeries] = useState({ loading: true });
  const [period, setPeriod] = useState('out_of_sample');
  const [evs, setEvs] = useState(null), [evId, setEvId] = useState(null), [ev, setEv] = useState({ loading: true });

  useEffect(() => { getValidationSummary().then(setSum).catch((e) => setSumErr(errMsg(e))); getValidationStations().then((r) => setStations(r.stations)).catch(() => setStations([])); }, []);
  useEffect(() => { getValidationEvents().then((r) => { setEvs(r); setEvId(r.featured || r.events[0]?.id || null); }).catch(() => setEvs({ events: [] })); }, []);
  useEffect(() => {
    let live = true; setSeries({ loading: true });
    getValidationStation(sid, days).then((d) => live && setSeries({ d })).catch((e) => live && setSeries({ error: errMsg(e) }));
    return () => { live = false; };
  }, [sid, days]);
  useEffect(() => {
    if (!evId) { if (evs) setEv({ none: true }); return undefined; }
    let live = true; setEv({ loading: true });
    getValidationEvent(evId).then((d) => live && setEv({ d })).catch((e) => live && setEv({ error: errMsg(e) }));
    return () => { live = false; };
  }, [evId, evs]);

  const H = sum?.headline;
  const st = useMemo(() => (stations || []).find((s) => s.id === sid), [stations, sid]);
  const chart = useMemo(() => (series.d ? series.d.t.map((t, i) => ({ t, gauge: series.d.gauge_m[i], model: series.d.model_m[i] })) : []), [series.d]);
  const hist = useMemo(() => {
    if (!sum) return [];
    const e = sum.histogram.bin_edges_min, c = sum.histogram.counts[period] || [];
    return c.map((n, i) => ({ bin: `${e[i]}`, lo: e[i], hi: e[i + 1], n, under: e[i + 1] <= sum.headline.target_min }));
  }, [sum, period]);
  const per = sum?.headline && (period === 'out_of_sample' ? sum.headline.timing_out_of_sample : sum.headline.timing_in_sample);
  const tt = useMemo(() => (stations || []).filter((s) => s.tide_timing && s.tide_timing.period === period), [stations, period]);
  const evList = (evs?.events || []).filter((e) => e.surge_distinguishable).slice(0, 5);
  const E = ev.d;

  if (sumErr) return <div className="page val"><PageHeader title="Validation" /><EmptyState icon={ShieldCheck} title="Validation unavailable">{sumErr}</EmptyState></div>;

  const evChart = E ? E.t.map((t, i) => ({ t, gauge: E.gauge_residual[i], model: E.model_residual[i] })) : [];
  const evTrackTime = E ? E.closest_time.slice(0, 13) : null;

  return (
    <div className="page val">
      <PageHeader title="Validation" subtitle="AquaDepth's sea-level driver and tide timing, checked against real tide gauges. Every number here is measured; the ones that miss their targets are shown as such." />

      <div className="grid c4 val-tiles" data-testid="val-tiles">
        <Stat label="Real tide gauges" icon={Radio} color="var(--blue)" loading={!H} value={H?.n_gauges} foot={H ? `UHSLC · India, Sri Lanka, Maldives, Bangladesh, Myanmar` : ''} />
        <Stat label="Sea-level RMSE" icon={Activity} color="var(--teal)" loading={!H} value={f(H?.median_rmse_m, 2)} unit=" m" foot="Median over gauges, mean offset removed" />
        <Stat label="Correlation" icon={Waves} color="var(--indigo)" loading={!H} value={f(H?.median_corr, 2)} unit=" r" foot={H ? `Median · tidal-range ratio ${f(H.median_range_ratio, 2)}×` : ''} />
        <Stat label="High-tide timing" icon={Clock} color={H?.target_met ? 'var(--green)' : 'var(--orange)'} loading={!H} value={f(H?.timing_median_min, 0)} unit=" min"
          foot={H ? <span className="val-foot">Median error · target {H.target_min} min <Badge tone={H.target_met ? 'green' : 'orange'}>{H.target_met ? 'Met' : 'Not met'}</Badge></span> : ''} />
      </div>
      {H && <p className="val-fine" data-testid="val-timing-note">Timing figure: out-of-sample hindcast (origins from 1 May 2026), {H.timing_out_of_sample?.n_peaks?.toLocaleString('en-IN')} real high waters at {H.timing_out_of_sample?.stations.join(', ')}. The raw Open-Meteo sea-level driver alone is closer ({f(H.timing_out_of_sample?.driver_only_median_min, 0)} min); the ML forecaster adds error on top.</p>}

      <Card className="val-disclose" data-testid="val-disclosure">
        <div className="val-disc-head"><AlertTriangle size={18} style={{ color: 'var(--orange)' }} /><h3>What this does and doesn't show</h3></div>
        <div className="grid c2 val-disc-cols">
          <div>
            <h4><CheckCircle2 size={15} style={{ color: 'var(--green)' }} /> Does show</h4>
            <ul>
              <li>How closely the model's <b>sea-level driver</b> (Open-Meteo Marine) follows real, independent tide-gauge observations.</li>
              <li>How accurately the forecaster times <b>high tide</b> compared with the real gauge, on held-out months.</li>
              <li>How a surge from a real cyclone looks in gauge data versus the model.</li>
            </ul>
          </div>
          <div>
            <h4><MinusCircle size={15} style={{ color: 'var(--orange)' }} /> Doesn't show</h4>
            <ul>
              <li><b>Depth itself is not validated.</b> Training labels were physics-simulated; no public depth-gauge network exists, so only sea level can be checked.</li>
              <li>A gauge is a point in a harbour or estuary; the model is a 0.05–0.25° grid cell. Some disagreement is scale mismatch.</li>
              <li>No INCOIS, IMD or NIO data were used. Gauge data are UHSLC fast-delta (not final) and end 30 Sep 2026 or earlier.</li>
            </ul>
          </div>
        </div>
      </Card>

      <div className="section-title">Sea level: gauge vs model</div>
      <Card data-testid="val-series">
        <div className="val-controls">
          <Segmented label="Station" value={sid} onChange={setSid} options={(stations || []).map((s) => ({ value: s.id, label: s.name }))} />
          <Segmented label="Range" value={days} onChange={setDays} options={[{ value: 7, label: '7d' }, { value: 30, label: '30d' }, { value: 90, label: '90d' }]} />
        </div>
        <div className="val-sub">
          {st ? `${st.name}, ${st.country} · ${f(st.lat, 2)}°N ${f(st.lon, 2)}°E · showing the ${days} days up to ${day(series.d?.t.at(-1) || st.last)} (${st.record_note})` : ' '}
        </div>
        {series.loading ? <Skel /> : series.error ? <EmptyState icon={AlertTriangle} title="Series unavailable">{series.error}</EmptyState> : (
          <div style={{ height: 280 }} role="img" aria-label={`Observed and modelled sea level at ${st?.name}`}>
            <ResponsiveContainer>
              <LineChart data={chart}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="t" axisLine={false} tickLine={false} minTickGap={48} tickFormatter={dayShort} />
                <YAxis axisLine={false} tickLine={false} width={50} domain={['auto', 'auto']} tickFormatter={(v) => v.toFixed(1)} unit=" m" />
                <Tooltip content={<ChartTip unit=" m" digits={2} labelFormatter={(t) => `${dayShort(t)} ${t.slice(11, 13)}:00 UTC`} />} />
                <Legend iconType="circle" />
                <Line type="monotone" dataKey="gauge" name="Observed (tide gauge)" stroke="var(--blue)" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="model" name="Model output" stroke="var(--orange)" strokeWidth={1.8} strokeDasharray="5 3" dot={false} connectNulls={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        {st?.agreement && (
          <div className="val-kv" data-testid="val-station-stats">
            <div><b>{f(st.agreement.rmse_m)} m</b><span>RMSE (whole record)</span></div>
            <div><b>{f(st.agreement.corr)}</b><span>Correlation</span></div>
            <div><b>{st.agreement.tidal_range_ratio != null ? `${f(st.agreement.tidal_range_ratio)}×` : '—'}</b><span>Tidal-range ratio (model ÷ gauge)</span></div>
            <div><b>{f(st.agreement.datum_offset_m)} m</b><span>Datum offset removed</span></div>
          </div>
        )}
        <p className="val-fine">Blue = real observation. Orange dashed = model output with the station's mean offset applied. Gaps are missing gauge data. {st && !st.has_post_cutoff && 'This gauge has no data after 1 May 2026, so everything shown for it overlaps the forecaster’s training period (the sea-level driver itself was never fitted to gauges).'}</p>
      </Card>

      <div className="section-title">High-tide timing</div>
      <Card data-testid="val-hist">
        <div className="val-controls">
          <CardTitle icon={Clock} color="var(--orange)" sub="Absolute difference between predicted and real high-water time, 24 h hindcasts every 3 h.">Timing error distribution</CardTitle>
          <Segmented label="Period" value={period} onChange={setPeriod} options={[{ value: 'out_of_sample', label: 'Out-of-sample' }, { value: 'in_sample', label: 'In-sample' }]} />
        </div>
        {!sum ? <Skel h={240} /> : (
          <>
            <div className="val-badges">
              <Badge tone={period === 'out_of_sample' ? 'green' : 'purple'}>{period === 'out_of_sample' ? 'Out-of-sample · from 1 May 2026' : 'In-sample · overlaps training period'}</Badge>
              {per && <span className="val-fine" style={{ margin: 0 }}>{per.n_peaks.toLocaleString('en-IN')} high waters · median {f(per.median_min, 0)} min · mean {f(per.mean_min, 0)} · p90 {f(per.p90_min, 0)} · {f(per.missed_pct, 0)}% unmatched · {per.stations.join(', ')}</span>}
            </div>
            <div style={{ height: 240 }} role="img" aria-label="Histogram of high-tide timing error in minutes">
              <ResponsiveContainer>
                <BarChart data={hist} barCategoryGap={2}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="bin" axisLine={false} tickLine={false} interval={5} unit=" min" />
                  <YAxis axisLine={false} tickLine={false} width={44} allowDecimals={false} />
                  <Tooltip cursor={{ fill: 'var(--fill-3)' }} content={({ active, payload }) => active && payload?.length ? <div className="chart-tip"><b>{payload[0].payload.lo}–{payload[0].payload.hi} min</b><div style={{ color: 'var(--label-2)' }}>{payload[0].payload.n} high waters</div></div> : null} />
                  <ReferenceLine x={`${sum.headline.target_min}`} stroke="var(--green)" strokeDasharray="4 3" label={{ value: '15 min target', position: 'top', fill: 'var(--green)', fontSize: 11 }} />
                  <Bar dataKey="n" radius={[3, 3, 0, 0]}>{hist.map((h, i) => <Cell key={i} fill={h.under ? 'var(--green)' : 'var(--blue)'} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="val-tt">
              {tt.map((s) => (
                <div key={s.id} className="val-tt-row"><span>{s.name}</span><span className="tnum"><b>{f(s.tide_timing.median_min, 0)}</b> min median <i>· raw driver {f(s.tide_timing.driver_only_median_min, 0)}</i></span></div>
              ))}
            </div>
          </>
        )}
        <p className="val-fine">Both the ML forecaster and its raw sea-level driver miss the 15-minute target. The driver leads the real gauge by roughly 30 minutes at most stations (signed); we report that rather than tune it away. The forecaster’s own error against its simulated labels was 21 min, so the real-gauge figure is expected to be worse.</p>
      </Card>

      <div className="section-title">Cyclone case study</div>
      <Card data-testid="val-event">
        {!evs || ev.loading ? <Skel h={360} /> : ev.none ? <EmptyState icon={Wind} title="No qualifying storm">No cyclone passed within 500 km of a gauge with usable data.</EmptyState> : ev.error ? <EmptyState icon={AlertTriangle} title="Case study unavailable">{ev.error}</EmptyState> : (
          <>
            <div className="val-controls">
              <CardTitle icon={Wind} color="var(--orange)" sub="Non-tidal water level during a real storm: observed gauge residual vs the model's.">{E.storm} at {E.station_name}</CardTitle>
              <Segmented label="Storm" value={evId} onChange={setEvId} options={evList.map((e) => ({ value: e.id, label: `${e.storm.replace('Unnamed depression', 'Depression')} · ${e.station_name}` }))} />
            </div>
            <div className="val-ev-grid">
              <div style={{ minWidth: 0 }}>
                <div style={{ height: 250 }} role="img" aria-label="Gauge versus model non-tidal residual during the storm">
                  <ResponsiveContainer>
                    <LineChart data={evChart}>
                      <CartesianGrid vertical={false} />
                      <XAxis dataKey="t" axisLine={false} tickLine={false} minTickGap={48} tickFormatter={dayShort} />
                      <YAxis axisLine={false} tickLine={false} width={50} domain={['auto', 'auto']} tickFormatter={(v) => v.toFixed(1)} unit=" m" />
                      <Tooltip content={<ChartTip unit=" m" digits={2} labelFormatter={(t) => `${dayShort(t)} ${t.slice(11, 13)}:00 UTC`} />} />
                      <Legend iconType="circle" />
                      <ReferenceLine x={evTrackTime} stroke="var(--label-3)" strokeDasharray="3 3" label={{ value: 'closest', position: 'insideTopRight', fill: 'var(--label-2)', fontSize: 11 }} />
                      <ReferenceLine y={0} stroke="var(--separator)" />
                      <Line type="monotone" dataKey="gauge" name="Observed residual (gauge)" stroke="var(--blue)" strokeWidth={2} dot={false} isAnimationActive={false} />
                      <Line type="monotone" dataKey="model" name="Model residual" stroke="var(--orange)" strokeWidth={1.8} strokeDasharray="5 3" dot={false} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="val-ev-side">
                <TrackMap ev={{ ...E, station_lat: E.station_lat, station_lon: E.station_lon }} />
                <div className="val-facts">
                  <div><span>Closest approach</span><b>{Math.round(E.closest_km)} km · {day(E.closest_time)}</b></div>
                  <div><span>Max winds (IBTrACS)</span><b>{E.max_wind_kt != null ? `${Math.round(E.max_wind_kt)} kt` : '—'}</b></div>
                  <div><span>Peak surge, gauge</span><b>{f(E.gauge_peak_residual_m)} m</b></div>
                  <div><span>Peak surge, model</span><b>{f(E.model_peak_residual_m)} m</b></div>
                  <div><span>Calm-weather noise (p95)</span><b>{f(E.calm_gauge_p95_m)} m</b></div>
                </div>
              </div>
            </div>
            <div className="val-verdict" data-testid="val-verdict"><Badge tone={E.period === 'in_sample' ? 'purple' : 'green'}>{E.period === 'in_sample' ? 'In-sample period' : 'Out-of-sample'}</Badge><p>{E.verdict}</p></div>
            <p className="val-fine">{E.caveat} {E.period === 'in_sample' && 'This storm pre-dates 1 May 2026, so it lies inside the forecaster’s training period (the Open-Meteo sea level is an independent product, but the case cannot be called out-of-sample). No qualifying storm occurred near a gauge after that date.'} The residual is also affected by tidal harmonic-fit error, which is large at Chittagong (4 m tides).</p>
          </>
        )}
      </Card>
    </div>
  );
}
