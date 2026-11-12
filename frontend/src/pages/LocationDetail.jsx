import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { AreaChart, Area, ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import {
  ChevronLeft, Copy, Check, Droplets, Waves, CloudRain, Thermometer, Wind, Gauge, Activity,
  Satellite, ShieldAlert, AlertCircle, ArrowUp, ArrowDown, Compass, Timer, Sun, Percent, Layers, Navigation,
} from 'lucide-react';
import {
  getCurrentDepth, getDepthForecast, getDepthHistory, getWeather, getTide, getTideExtremes,
  getFloodRisk, getLocationDetail, getSatelliteData,
} from '../services/api';
import { Card, CardTitle, Badge, List, ListRow, Segmented, ChartTip, fadeUp } from '../components/ui';
import { fmtNum, fmtDateTime, TYPE_BADGE, LEVEL_BADGE, LEVEL_COLOR } from '../lib/format';
import './LocationDetail.css';

const num = (v, d = 2) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(d) : '—');
const signed = (v, d = 2) => (typeof v === 'number' && Number.isFinite(v) ? `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}` : '—');
const hh = (iso) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', hour12: true });
const dayHour = (iso) => new Date(iso).toLocaleString('en-IN', { weekday: 'short', hour: 'numeric', hour12: true });
const HORIZONS = [{ value: 6, label: '6h' }, { value: 12, label: '12h' }, { value: 24, label: '24h' }, { value: 48, label: '48h' }];

const Sk = ({ h = 16, w = '100%', style }) => <div className="skeleton" style={{ height: h, width: w, ...style }} />;

function Section({ state, retry, skeleton, children }) {
  if (state.loading) return skeleton || <Sk h={120} />;
  if (state.error || !state.data) {
    return (
      <div className="ld-err"><AlertCircle size={18} /> Couldn’t load this section.
        <button onClick={retry}>Retry</button></div>
    );
  }
  return children(state.data);
}

function useSection(fn, deps) {
  const [s, setS] = useState({ loading: true, data: null, error: false });
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    setS({ loading: true, data: null, error: false });
    Promise.resolve().then(fn).then(
      (d) => live && setS({ loading: false, data: d, error: false }),
      () => live && setS({ loading: false, data: null, error: true }),
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return [s, useCallback(() => setN((x) => x + 1), [])];
}

function Ring({ value, color }) {
  const r = 46, c = 2 * Math.PI * r, v = Math.max(0, Math.min(1, value || 0));
  return (
    <div className="ld-ring">
      <svg width="108" height="108" viewBox="0 0 108 108">
        <circle cx="54" cy="54" r={r} fill="none" stroke="var(--fill-3)" strokeWidth="10" />
        <motion.circle cx="54" cy="54" r={r} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - v) }}
          transition={{ duration: 0.9, ease: [0.32, 0.72, 0, 1] }} />
      </svg>
      <b><span>{Math.round(v * 100)}<small style={{ fontSize: 13, color: 'var(--label-2)', fontWeight: 500 }}>%</small></span></b>
    </div>
  );
}

const axisProps = { axisLine: false, tickLine: false, tick: { fontSize: 11 } };

export default function LocationDetail() {
  const { digipin } = useParams();
  const navigate = useNavigate();
  const [horizon, setHorizon] = useState(48);
  const [copied, setCopied] = useState(false);

  const [loc, retryLoc] = useSection(() => getLocationDetail(digipin), [digipin]);
  const [depth, retryDepth] = useSection(() => getCurrentDepth({ digipin }), [digipin]);
  const [fc, retryFc] = useSection(() => getDepthForecast({ digipin, hours_ahead: 48 }), [digipin]);
  const [hist, retryHist] = useSection(() => getDepthHistory(digipin, 72), [digipin]);
  const [wx, retryWx] = useSection(() => getWeather({ digipin }), [digipin]);
  const [tide, retryTide] = useSection(() => getTide({ digipin }), [digipin]);
  const [flood, retryFlood] = useSection(() => getFloodRisk({ digipin }), [digipin]);
  const [sat, retrySat] = useSection(() => getSatelliteData(digipin), [digipin]);
  const [ext, retryExt] = useSection(async () => {
    const l = await getLocationDetail(digipin);
    return getTideExtremes(l.latitude, l.longitude, 3);
  }, [digipin]);

  useEffect(() => { window.scrollTo?.(0, 0); document.querySelector('.main')?.scrollTo?.(0, 0); }, [digipin]);

  const L = loc.data;
  const type = L?.water_body_type;
  const copy = () => {
    navigator.clipboard?.writeText(digipin).catch(() => {});
    setCopied(true); setTimeout(() => setCopied(false), 1400);
  };

  const fcData = useMemo(() => (fc.data?.forecast || []).slice(0, horizon).map((f) => ({
    t: f.timestamp, depth: f.predicted_depth, band: [f.confidence_low, f.confidence_high],
  })), [fc.data, horizon]);
  const fcDomain = useMemo(() => {
    if (!fcData.length) return ['auto', 'auto'];
    const lo = Math.min(...fcData.map((d) => d.band[0])), hi = Math.max(...fcData.map((d) => d.band[1]));
    const pad = Math.max((hi - lo) * 0.2, 0.05);
    return [lo - pad, hi + pad];
  }, [fcData]);
  const histData = useMemo(() => (hist.data?.readings || []).filter((_, i) => i % 2 === 0).map((r) => ({
    t: r.timestamp, depth: r.computed_depth, tide: r.tidal_offset,
  })), [hist.data]);

  const d = depth.data;
  const fusion = d && [
    ['Base depth', `${num(d.base_depth)} m`, Layers, 'var(--indigo)'],
    ['Tide', `${signed(d.tidal_offset)} m`, Waves, 'var(--blue)'],
    ['Rainfall', `${signed(d.rainfall_impact)} m`, CloudRain, 'var(--teal)'],
    ['Discharge', `${signed(d.discharge_delta)} m`, Activity, 'var(--purple)'],
    ['Confidence', `${Math.round((d.confidence || 0) * 100)}%`, Percent, 'var(--green)'],
  ];

  return (
    <div className="page" key={digipin}>
      <button className="ld-back" onClick={() => navigate(-1)} aria-label="Back to map"><ChevronLeft />Map</button>

      <motion.header {...fadeUp}>
        {loc.loading ? <><Sk h={36} w="55%" /><Sk h={22} w="75%" style={{ marginTop: 14 }} /></> : (
          <>
            <h1 className="large-title">{L?.name || 'Location'}</h1>
            <div className="ld-meta">
              {type && <Badge tone={TYPE_BADGE[type]}>{type}</Badge>}
              {L && <span className="tnum">{num(L.latitude, 4)}°N, {num(L.longitude, 4)}°E</span>}
              {L?.region && <span>{L.region}</span>}
              <button className="ld-copy mono" onClick={copy} aria-label="Copy DIGIPIN">
                {digipin}{copied ? <Check style={{ color: 'var(--green)' }} /> : <Copy />}
              </button>
            </div>
          </>
        )}
      </motion.header>

      {/* Hero */}
      <motion.section className="ld-hero" {...fadeUp} transition={{ ...fadeUp.transition, delay: 0.05 }} aria-label="Current depth">
        <Card>
          <div className="ld-eyebrow"><Droplets style={{ color: 'var(--blue)' }} />Current depth</div>
          <Section state={depth} retry={retryDepth} skeleton={<><Sk h={60} w="50%" /><Sk h={44} style={{ marginTop: 22 }} /></>}>
            {(x) => (
              <>
                <div className="ld-big" data-testid="depth-value">{num(x.computed_depth, 1)}<small>m</small></div>
                <div className="ld-note" style={{ marginTop: 8 }}>Updated {fmtDateTime(x.timestamp)}</div>
                <div className="equation ld-eq">
                  {num(x.base_depth, 1)} {x.tidal_offset < 0 ? '−' : '+'} {num(Math.abs(x.tidal_offset))} (tide) {x.rainfall_impact < 0 ? '−' : '+'} {num(Math.abs(x.rainfall_impact))} (rain) {(x.discharge_delta || 0) < 0 ? '−' : '+'} {num(Math.abs(x.discharge_delta || 0))} (discharge) = <b>{num(x.computed_depth, 1)} m</b>
                </div>
              </>
            )}
          </Section>
        </Card>
        <div>
          {depth.loading ? <Card><Sk h={200} /></Card> : fusion ? (
            <List aria-label="Depth fusion breakdown" style={{ height: '100%' }}>
              {fusion.map(([t, v, Ic, c]) => <ListRow key={t} icon={Ic} iconColor={c} title={t} value={v} />)}
            </List>
          ) : <Card><div className="ld-err"><AlertCircle size={18} />Breakdown unavailable.<button onClick={retryDepth}>Retry</button></div></Card>}
        </div>
      </motion.section>

      {/* Forecast */}
      <Card className="ld-sec" aria-label="Forecast">
        <div className="ld-head">
          <div><CardTitle icon={Activity} color="var(--blue)" sub={`Next ${horizon} hours, with confidence band`}>Forecast</CardTitle></div>
          <Segmented label="Forecast horizon" options={HORIZONS} value={horizon} onChange={setHorizon} />
        </div>
        <Section state={fc} retry={retryFc} skeleton={<Sk h={240} />}>
          {() => (
            <>
              <div className="ld-chart">
                <ResponsiveContainer>
                  <AreaChart data={fcData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="ldfc" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--blue)" stopOpacity={0.28} /><stop offset="100%" stopColor="var(--blue)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="t" {...axisProps} tickFormatter={hh} minTickGap={36} />
                    <YAxis {...axisProps} width={44} domain={fcDomain} tickFormatter={(v) => v.toFixed(1)} />
                    <Tooltip content={<ChartTip unit=" m" labelFormatter={dayHour} />} cursor={{ stroke: 'var(--label-3)' }} />
                    <Area type="monotone" dataKey="band" name="Range" stroke="none" fill="var(--blue)" fillOpacity={0.14} isAnimationActive={false} activeDot={false} />
                    <Area type="monotone" dataKey="depth" name="Depth" stroke="var(--blue)" strokeWidth={2.25} fill="url(#ldfc)" strokeLinecap="round" dot={false} activeDot={{ r: 4, fill: 'var(--blue)', stroke: 'var(--bg-elevated)', strokeWidth: 2 }} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="ld-legend"><span><i style={{ background: 'var(--blue)' }} />Predicted depth</span><span><i className="band" style={{ background: 'var(--blue)' }} />Confidence range</span></div>
            </>
          )}
        </Section>
      </Card>

      {/* Tide + flood */}
      <div className="grid c2 ld-sec">
        <Card aria-label="Tide">
          <CardTitle icon={Waves} color="var(--blue)" sub="Sea level, waves and upcoming extremes">Tide</CardTitle>
          <Section state={tide} retry={retryTide} skeleton={<Sk h={180} />}>
            {(t) => (
              <>
                <div className="row between" style={{ margin: '6px 0 12px' }}>
                  <div className="stat-value">{num(t.sea_level_m)}<small>m</small></div>
                  <Badge tone="blue">{t.tide_phase || 'unknown'} tide</Badge>
                </div>
                <List className="ld-inner">
                  <ListRow icon={Waves} iconColor="var(--teal)" title="Wave height" value={`${num(t.wave_height_m)} m`} />
                  <ListRow icon={Timer} iconColor="var(--indigo)" title="Wave period" value={`${num(t.wave_period_s, 1)} s`} />
                  <ListRow icon={Compass} iconColor="var(--orange)" title="Wave direction" value={t.wave_direction_deg != null ? `${Math.round(t.wave_direction_deg)}°` : '—'} />
                </List>
              </>
            )}
          </Section>
          <div style={{ marginTop: 14 }}>
            <div className="ld-eyebrow" style={{ marginBottom: 6 }}>Upcoming high / low</div>
            <Section state={ext} retry={retryExt} skeleton={<Sk h={48} />}>
              {(e) => (e.tide_extremes?.length ? (
                <List className="ld-inner">
                  {e.tide_extremes.slice(0, 6).map((x, i) => {
                    const high = String(x.type || x.kind || '').toLowerCase().startsWith('h');
                    return <ListRow key={i} icon={high ? ArrowUp : ArrowDown} iconColor={high ? 'var(--blue)' : 'var(--teal)'}
                      title={high ? 'High tide' : 'Low tide'} detail={fmtDateTime(x.time || x.timestamp)} value={x.height_m != null ? `${num(x.height_m)} m` : '—'} />;
                  })}
                </List>
              ) : <div className="ld-note" style={{ marginTop: 0 }}>Tide extremes aren’t available for this location right now.</div>)}
            </Section>
          </div>
        </Card>

        <Card aria-label="Flood risk">
          <CardTitle icon={ShieldAlert} color="var(--orange)" sub="Risk score from rainfall and discharge">Flood risk</CardTitle>
          <Section state={flood} retry={retryFlood} skeleton={<Sk h={140} />}>
            {(f) => {
              const lv = f.alert_level || 'none';
              return (
                <>
                  <div className="ld-gauge" style={{ marginTop: 8 }}>
                    <Ring value={f.risk_score} color={LEVEL_COLOR[lv] || 'var(--green)'} />
                    <div className="ld-gauge-txt">
                      <Badge tone={LEVEL_BADGE[lv] || 'green'}>{lv === 'none' ? 'No alert' : lv}</Badge>
                      <p style={{ marginTop: 8, fontSize: 14, color: 'var(--label-2)' }}>{f.details || 'No details available.'}</p>
                    </div>
                  </div>
                  <List className="ld-inner" style={{ marginTop: 16 }}>
                    <ListRow title="Discharge" value={f.discharge_m3s != null ? `${num(f.discharge_m3s)} m³/s` : '—'} />
                    <ListRow title="Rainfall deviation" value={f.rainfall_deviation != null ? `${fmtNum(f.rainfall_deviation, 0)}%` : '—'} />
                  </List>
                </>
              );
            }}
          </Section>
        </Card>
      </div>

      {/* History */}
      <Card className="ld-sec" aria-label="History">
        <CardTitle icon={Timer} color="var(--indigo)" sub="Past 72 hours. Depth on the left axis, tide offset on the right.">History</CardTitle>
        <Section state={hist} retry={retryHist} skeleton={<Sk h={240} />}>
          {() => (
            <>
              <div className="ld-chart">
                <ResponsiveContainer>
                  <ComposedChart data={histData} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="ldh" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--indigo)" stopOpacity={0.24} /><stop offset="100%" stopColor="var(--indigo)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="t" {...axisProps} tickFormatter={dayHour} minTickGap={50} />
                    <YAxis yAxisId="l" {...axisProps} width={44} domain={['auto', 'auto']} tickFormatter={(v) => v.toFixed(1)} />
                    <YAxis yAxisId="r" orientation="right" {...axisProps} width={40} domain={['auto', 'auto']} tickFormatter={(v) => v.toFixed(1)} />
                    <Tooltip content={<ChartTip unit=" m" labelFormatter={dayHour} />} cursor={{ stroke: 'var(--label-3)' }} />
                    <Area yAxisId="l" type="monotone" dataKey="depth" name="Depth" stroke="var(--indigo)" strokeWidth={2.25} fill="url(#ldh)" dot={false} activeDot={{ r: 4 }} />
                    <Line yAxisId="r" type="monotone" dataKey="tide" name="Tide offset" stroke="var(--teal)" strokeWidth={1.75} dot={false} strokeLinecap="round" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="ld-legend"><span><i style={{ background: 'var(--indigo)' }} />Depth (left)</span><span><i style={{ background: 'var(--teal)' }} />Tide offset (right)</span></div>
            </>
          )}
        </Section>
      </Card>

      {/* Weather + satellite */}
      <div className="grid c2 ld-sec">
        <div aria-label="Weather">
          <div className="section-title" style={{ marginTop: 0 }}>Weather</div>
          {wx.loading ? <Card><Sk h={220} /></Card> : wx.data ? (
            <List>
              <ListRow icon={Thermometer} iconColor="var(--orange)" title="Temperature" value={`${num(wx.data.temperature_c, 1)} °C`} />
              <ListRow icon={Droplets} iconColor="var(--blue)" title="Humidity" value={`${num(wx.data.humidity_pct, 0)}%`} />
              <ListRow icon={Gauge} iconColor="var(--indigo)" title="Pressure" value={`${num(wx.data.pressure_hpa, 0)} hPa`} />
              <ListRow icon={Wind} iconColor="var(--teal)" title="Wind" value={`${num(wx.data.wind_speed_ms, 1)} m/s`} />
              <ListRow icon={CloudRain} iconColor="var(--blue)" title="Rain now" value={`${num(wx.data.precipitation_mm, 1)} mm`} />
              <ListRow icon={CloudRain} iconColor="var(--purple)" title="Rain, last 72 h" value={`${num(wx.data.precipitation_72h, 1)} mm`} />
            </List>
          ) : <Card><div className="ld-err"><AlertCircle size={18} />Weather unavailable.<button onClick={retryWx}>Retry</button></div></Card>}
        </div>
        <div aria-label="Satellite">
          <div className="section-title" style={{ marginTop: 0 }}>Satellite-derived altimetry</div>
          {sat.loading ? <Card><Sk h={220} /></Card> : sat.data ? (
            <>
              <List>
                <ListRow icon={Satellite} iconColor="var(--indigo)" title="Sea-surface anomaly" value={`${signed(sat.data.sea_surface_height_anomaly_m, 3)} m`} />
                <ListRow icon={Gauge} iconColor="var(--blue)" title="Inverse-barometer correction" value={`${signed(sat.data.inverse_barometer_correction_m, 3)} m`} />
                <ListRow icon={Wind} iconColor="var(--teal)" title="Wind set-up" value={`${signed(sat.data.wind_setup_m, 3)} m`} />
                <ListRow icon={Waves} iconColor="var(--green)" title="Significant wave height" value={`${num(sat.data.significant_wave_height_m)} m`} />
                <ListRow icon={Navigation} iconColor="var(--purple)" title="Swell height" value={`${num(sat.data.swell_height_m)} m`} />
              </List>
              <p className="ld-note" style={{ padding: '0 4px' }}>Derived estimate from marine and weather models ({sat.data.data_source || 'fusion'}), a proxy for {sat.data.satellite_proxy || 'satellite altimetry'}. Not a direct satellite measurement.</p>
            </>
          ) : <Card><div className="ld-err"><AlertCircle size={18} />Altimetry unavailable.<button onClick={retrySat}>Retry</button></div></Card>}
        </div>
      </div>
    </div>
  );
}
