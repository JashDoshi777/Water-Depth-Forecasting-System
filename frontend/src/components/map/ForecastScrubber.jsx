import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Play, Pause } from 'lucide-react';
import { spring } from '../ui';
import { getForecastGrid } from '../../services/api_map';
import { FIELD_META, rampFor, rampCssFor, renderField, gridCoords, setForecastImage, hideForecast } from '../../lib/mapStyle';

const VARS = [{ value: 'rain', label: 'Rain' }, { value: 'wave', label: 'Waves' }, { value: 'wind', label: 'Wind' }];
const fmtT = (ms) => {
  const d = new Date(ms);
  return `${d.toLocaleDateString('en-IN', { weekday: 'short' })} ${d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase()}`;
};
const CW = 520;

export default function ForecastScrubber({ map, ready, variable, onVariable, onUnavailable }) {
  const [grid, setGrid] = useState(null);
  const [status, setStatus] = useState('loading');
  const [pos, setPos] = useState(0);
  const [playing, setPlaying] = useState(false);
  const canvas = useRef(null);
  const cache = useRef({});
  const raf = useRef(0);
  const lastRender = useRef(0);

  const load = useCallback(async () => {
    setStatus('loading');
    if (!cache.current[variable]) setGrid(null);
    try {
      const g = cache.current[variable] || await getForecastGrid(variable, 48, 3);
      cache.current[variable] = g;
      setGrid(g); setStatus('ready');
    } catch { setGrid(null); setStatus('error'); onUnavailable?.(); }
  }, [variable]); // eslint-disable-line
  useEffect(() => { load(); }, [load]);

  const times = useMemo(() => (grid ? grid.times.map((t) => new Date(t).getTime()) : []), [grid]);
  const nowIdx = useMemo(() => {
    if (!times.length) return 0;
    const now = Date.now();
    if (now <= times[0]) return 0;
    for (let i = 1; i < times.length; i++) if (now <= times[i]) return i - 1 + (now - times[i - 1]) / (times[i] - times[i - 1]);
    return times.length - 1;
  }, [times]);
  const maxIdx = Math.max(1, (grid?.frames.length || 2) - 1);

  // start at 'now' when a new grid arrives
  useEffect(() => { if (grid) setPos(Math.min(maxIdx, nowIdx)); }, [grid]); // eslint-disable-line

  // paint current position onto the map
  useEffect(() => {
    if (!map || !ready || !grid) return undefined;
    clearTimeout(raf.current);
    raf.current = setTimeout(() => {
      const b = grid.bounds;
      const aspect = (b.lat_max - b.lat_min) / (b.lon_max - b.lon_min);
      const c = canvas.current || (canvas.current = document.createElement('canvas'));
      c.width = CW; c.height = Math.round(CW * Math.min(1.6, Math.max(0.5, aspect * 1.15)));
      renderField(c, grid, pos, rampFor(variable, grid.unit));
      try { setForecastImage(map, c.toDataURL('image/png'), gridCoords(b)); } catch { /* map removed */ }
      lastRender.current = performance.now();
    }, Math.max(0, 80 - (performance.now() - lastRender.current)));
    return () => clearTimeout(raf.current);
  }, [map, ready, grid, pos, variable]);

  useEffect(() => () => { if (map && map.getStyle?.()) hideForecast(map); }, [map]);

  // playback
  useEffect(() => {
    if (!playing || !grid) return undefined;
    let last = performance.now(), id;
    const tick = (t) => {
      const dt = (t - last) / 1000; last = t;
      setPos((p) => (p + dt * 1.1 >= maxIdx ? 0 : p + dt * 1.1));
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [playing, grid, maxIdx]);

  const label = useMemo(() => {
    if (!times.length) return '—';
    const i = Math.min(times.length - 1, Math.floor(pos));
    const ms = times[i] + ((times[Math.min(times.length - 1, i + 1)] - times[i]) * (pos - i));
    return fmtT(ms);
  }, [pos, times]);

  const meta = FIELD_META[variable];
  const unit = grid?.unit || meta.unit;
  const ramp = grid ? rampFor(variable, grid.unit) : null;
  const max = ramp ? ramp[ramp.length - 2][0] : 1;
  const isNow = Math.abs(pos - nowIdx) < 0.5;

  return (
    <motion.div className="scrubber material" role="group" aria-label="Forecast controls"
      initial={{ opacity: 0, y: 24, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 24 }} transition={spring}>
      <div className="sc-top">
        <div className="ls-seg sc-vars" role="group" aria-label="Forecast variable">
          {VARS.map((v) => (
            <button key={v.value} className={variable === v.value ? 'active' : ''} aria-pressed={variable === v.value} onClick={() => onVariable(v.value)}>{v.label}</button>
          ))}
        </div>
        <div className="sc-time" data-testid="scrub-time" aria-live="polite">{status === 'ready' ? (isNow ? `Now · ${label}` : label) : status === 'loading' ? <span className="skeleton" style={{ display: 'inline-block', width: 110, height: 14 }} /> : '—'}</div>
      </div>
      {status === 'error' ? (
        <div className="sc-note" role="status">Forecast field isn’t available right now. <button className="link" onClick={load}>Retry</button></div>
      ) : (
        <>
          <div className="sc-track">
            <button className="sc-play" aria-label={playing ? 'Pause forecast animation' : 'Play forecast animation'} onClick={() => setPlaying((p) => !p)} disabled={!grid}>
              {playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
            </button>
            <div className="sc-range">
              <input type="range" min={0} max={maxIdx} step={0.01} value={pos} disabled={!grid}
                aria-label="Forecast time" aria-valuetext={label}
                onChange={(e) => { setPlaying(false); setPos(Number(e.target.value)); }}
                onKeyDown={(e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); setPlaying(false); setPos((p) => Math.max(0, Math.min(maxIdx, Math.round(p) + (e.key === 'ArrowRight' ? 1 : -1)))); } }} />
              {grid && nowIdx > 0.05 && nowIdx < maxIdx && <i className="sc-now" style={{ left: `${(nowIdx / maxIdx) * 100}%` }} aria-hidden="true" />}
            </div>
            <button className="sc-nowbtn" onClick={() => { setPlaying(false); setPos(Math.min(maxIdx, nowIdx)); }} disabled={!grid}>Now</button>
          </div>
          <div className="sc-legend" aria-label={`${meta.label} legend`} style={grid ? undefined : { opacity: 0.35 }}>
            <span>0</span>
            <div className="ramp" style={{ background: ramp ? rampCssFor(variable, grid.unit) : undefined }} />
            <span>{Math.round(max)} {unit}</span>
          </div>
        </>
      )}
    </motion.div>
  );
}
