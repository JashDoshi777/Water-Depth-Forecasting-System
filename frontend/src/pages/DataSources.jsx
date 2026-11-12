import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CloudSun, Waves, Droplets, Anchor, Mountain, Grid3x3, ChevronDown, ArrowRight, WifiOff,
  CheckCircle2, CircleDashed, Info, Activity, Database, Timer,
} from 'lucide-react';
import { PageHeader, Card, Stat, Badge, List, EmptyState, fadeUp } from '../components/ui';
import { fmtNum } from '../lib/format';
import { getSystemStatus } from '../services/api';
import './DataSources.css';

const SOURCES = [
  { key: 'open_meteo_weather', icon: CloudSun, color: 'var(--blue)', name: 'Open-Meteo Weather', role: 'Rainfall, pressure, wind, temperature',
    desc: 'Hourly and daily forecasts from ECMWF and GFS models, plus reanalysis history. Drives the rainfall term of the depth model.' },
  { key: 'open_meteo_marine', icon: Waves, color: 'var(--teal)', name: 'Open-Meteo Marine', role: 'Waves, sea level, satellite-style altimetry',
    desc: 'WAM wave model output. Our “satellite altimetry” layer is derived from this marine model, not from a direct altimeter feed.' },
  { key: 'open_meteo_flood', icon: Droplets, color: 'var(--indigo)', name: 'Open-Meteo Flood (GloFAS)', role: 'River discharge',
    desc: 'Modelled river discharge from the Global Flood Awareness System, served through Open-Meteo. Not gauge-station measurements.' },
  { key: 'stormglass', icon: Anchor, color: 'var(--purple)', name: 'StormGlass', role: 'Tide heights and extremes',
    desc: 'Tidal predictions for coastal points. Requires an API key; shown as configured when the key is present.' },
  { key: 'opentopography', icon: Mountain, color: 'var(--green)', name: 'OpenTopography', role: 'Terrain and bathymetry',
    desc: 'Elevation datasets for terrain context. Depth baselines currently use a GEBCO-style bathymetry model.' },
  { key: 'digipin_grid', icon: Grid3x3, color: 'var(--orange)', name: 'DIGIPIN Grid', role: 'Location addressing',
    desc: 'India Post’s 10-character geocode, computed locally with no network dependency.' },
];

const STATUS = {
  online: { label: 'Online', tone: 'green', dot: 'var(--green)' },
  configured: { label: 'Configured', tone: 'blue', dot: 'var(--blue)' },
  degraded: { label: 'Degraded', tone: 'orange', dot: 'var(--orange)' },
  offline: { label: 'Offline', tone: 'red', dot: 'var(--red)' },
  not_configured: { label: 'Not configured', tone: '', dot: 'var(--label-3)' },
};
const HEALTHY = new Set(['online', 'configured']);

const COVERAGE = [
  { s: 'real', t: 'Rainfall, weather and forecasts', d: 'Live Open-Meteo (ECMWF/GFS) data.' },
  { s: 'real', t: 'River discharge', d: 'GloFAS model output via Open-Meteo Flood.' },
  { s: 'real', t: 'Tide predictions', d: 'StormGlass tidal data for coastal points when the key is active.' },
  { s: 'real', t: 'DIGIPIN addressing', d: 'Computed locally per the India Post specification.' },
  { s: 'sim', t: 'Satellite altimetry', d: 'Derived from the Open-Meteo marine model, not a direct satellite altimeter feed.' },
  { s: 'sim', t: 'Absolute depth values', d: 'Physics-based estimates on a bathymetry model, not sensor readings.' },
  { s: 'none', t: 'INCOIS ocean services', d: 'Not integrated.' },
  { s: 'none', t: 'IMD observations', d: 'Not integrated. Weather comes from global models instead.' },
  { s: 'none', t: 'India-WRIS gauge data', d: 'Not integrated. No in-situ river or reservoir gauges.' },
];
const COV = {
  real: { label: 'Real data', tone: 'green', icon: CheckCircle2, color: 'var(--green)' },
  sim: { label: 'Derived / modelled', tone: 'orange', icon: Info, color: 'var(--orange)' },
  none: { label: 'Not integrated', tone: '', icon: CircleDashed, color: 'var(--label-3)' },
};

const PIPE = ['Data sources', 'DIGIPIN grid', 'Fusion model', 'Depth + risk', 'Forecast & alerts'];

function SourceRow({ src, info, open, onToggle }) {
  const st = STATUS[info?.status] || STATUS.not_configured;
  const Icon = src.icon;
  return (
    <div className="ds-item" data-source={src.key}>
      <div className="list-row tappable ds-row" role="button" tabIndex={0} aria-expanded={open} onClick={onToggle}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onToggle())}>
        <span className="icon-chip" style={{ background: src.color }}><Icon /></span>
        <div className="list-main">
          <div className="list-title">{src.name}</div>
          <div className="list-detail">{src.role}</div>
        </div>
        <span className="ds-status">
          <i className="ds-dot" style={{ background: st.dot }} />
          <span>{st.label}</span>
          {info?.latency_ms != null && <span className="tnum ds-lat">{fmtNum(info.latency_ms)} ms</span>}
        </span>
        <ChevronDown className={`chev ds-chev ${open ? 'open' : ''}`} />
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div className="ds-more" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}>
            <div className="ds-more-inner">
              <p>{src.desc}</p>
              <dl>
                <div><dt>Status</dt><dd><Badge tone={st.tone}>{st.label}</Badge></dd></div>
                <div><dt>Latency</dt><dd className="tnum">{info?.latency_ms != null ? `${fmtNum(info.latency_ms)} ms` : 'n/a'}</dd></div>
                {info?.detail && <div><dt>Note</dt><dd>{info.detail}</dd></div>}
              </dl>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function DataSources() {
  const [state, setState] = useState({ s: 'loading' });
  const [open, setOpen] = useState(null);

  const load = () => {
    setState({ s: 'loading' });
    getSystemStatus().then((d) => setState({ s: 'ok', d })).catch(() => setState({ s: 'error' }));
  };
  useEffect(load, []);

  const d = state.d;
  const byKey = Object.fromEntries((d?.sources || []).map((x) => [x.key, x]));
  const healthy = SOURCES.filter((s) => HEALTHY.has(byKey[s.key]?.status)).length;
  const ld = state.s === 'loading';
  const stag = (i) => ({ ...fadeUp, transition: { ...fadeUp.transition, delay: Math.min(i, 8) * 0.04 } });

  return (
    <div className="page ds">
      <PageHeader title="Data Sources" subtitle="Where every number comes from, how healthy each feed is, and what is modelled rather than measured." />

      <div className="grid c3 ds-stats">
        <motion.div {...stag(0)}><Stat loading={ld} label="Sources healthy" icon={Activity} color="var(--green)" value={state.s === 'error' ? '—' : `${healthy}/${SOURCES.length}`} foot={state.s === 'error' ? 'Status unavailable' : healthy === SOURCES.length ? 'Everything is running' : 'Some sources need attention'} /></motion.div>
        <motion.div {...stag(1)}><Stat loading={ld} label="Average latency" icon={Timer} color="var(--orange)" value={d?.avg_latency_ms != null ? fmtNum(d.avg_latency_ms) : '—'} unit={d?.avg_latency_ms != null ? 'ms' : ''} foot="Across live API sources" /></motion.div>
        <motion.div {...stag(2)}><Stat loading={ld} label="Locations indexed" icon={Database} color="var(--blue)" value={d?.locations_indexed != null ? fmtNum(d.locations_indexed) : '—'} foot="Each with a DIGIPIN address" /></motion.div>
      </div>

      <h2 className="section-title">Live sources</h2>
      {state.s === 'error' ? (
        <Card><EmptyState icon={WifiOff} title="Couldn’t load source status" action={<button className="btn" onClick={load}>Try again</button>}>The status service didn’t respond.</EmptyState></Card>
      ) : ld ? (
        <List>{SOURCES.map((s) => (
          <div key={s.key} className="list-row" style={{ minHeight: 60 }}>
            <div className="skeleton" style={{ width: 30, height: 30, borderRadius: 8 }} />
            <div className="list-main"><div className="skeleton" style={{ height: 13, width: '45%', marginBottom: 7 }} /><div className="skeleton" style={{ height: 11, width: '65%' }} /></div>
          </div>))}
        </List>
      ) : (
        <motion.div {...stag(3)}>
          <List>{SOURCES.map((s) => <SourceRow key={s.key} src={s} info={byKey[s.key]} open={open === s.key} onToggle={() => setOpen((o) => (o === s.key ? null : s.key))} />)}</List>
        </motion.div>
      )}

      <h2 className="section-title">Data fusion</h2>
      <Card>
        <div className="card-title">Depth model</div>
        <div className="card-sub">Each factor is fetched per location and combined into one depth estimate.</div>
        <div className="equation">Depth = Base + α·Rainfall + β·Tide + γ·Discharge − δ·Evaporation</div>
        <ol className="ds-pipe" aria-label="Processing pipeline">
          {PIPE.map((p, i) => (
            <li key={p}>
              <span className="ds-step"><b className="tnum">{i + 1}</b>{p}</span>
              {i < PIPE.length - 1 && <ArrowRight className="ds-arrow" size={16} />}
            </li>
          ))}
        </ol>
      </Card>

      <h2 className="section-title">Data coverage vs project brief</h2>
      <List>
        {COVERAGE.map((c) => {
          const m = COV[c.s]; const I = m.icon;
          return (
            <div key={c.t} className="list-row ds-cov" data-coverage={c.s}>
              <span className="icon-chip" style={{ background: m.color }}><I /></span>
              <div className="list-main"><div className="list-title ds-wrap">{c.t}</div><div className="list-detail">{c.d}</div></div>
              <Badge tone={m.tone}>{m.label}</Badge>
            </div>
          );
        })}
      </List>
      <p className="ds-foot">Absolute depth figures are modelled estimates. Treat them as indicative, not as survey measurements.</p>
    </div>
  );
}
