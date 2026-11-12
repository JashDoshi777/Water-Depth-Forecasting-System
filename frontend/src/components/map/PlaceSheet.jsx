import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, animate, useDragControls, useAnimationControls, AnimatePresence } from 'framer-motion';
import { X, Star, Share, ChevronRight, Thermometer, CloudRain, Wind, Droplets, Waves, MapPin } from 'lucide-react';
import { Badge, spring } from '../ui';
import { TYPE_BADGE, fmtM } from '../../lib/format';
import { useWatchlist } from '../../lib/watchlist';

function CountUp({ value, digits = 1 }) {
  const [v, setV] = useState(0);
  const prev = useRef(0);
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { prev.current = value; setV(value); return undefined; }
    const c = animate(prev.current, value, { duration: 0.9, ease: [0.32, 0.72, 0, 1], onUpdate: (x) => { prev.current = x; setV(x); } });
    return () => c.stop();
  }, [value]);
  return <>{Number(v).toFixed(digits)}</>;
}

function Cell({ label, value }) {
  return <div className="mp-cell"><span>{label}</span><b>{value}</b></div>;
}

/** Tiny semidiurnal tide arc with a "now" dot positioned from the reported phase. */
function TideArc({ tide }) {
  const phase = String(tide.tide_phase || '').toLowerCase();
  const t = /rising|flood/.test(phase) ? 0.25 : /falling|ebb/.test(phase) ? 0.75 : /high/.test(phase) ? 0.5 : /low/.test(phase) ? 0 : 0.25;
  const W = 300, H = 56, pad = 10;
  const pts = Array.from({ length: 61 }, (_, i) => {
    const x = pad + ((W - 2 * pad) * i) / 60; const y = H / 2 - Math.sin((i / 60) * Math.PI * 2 - Math.PI / 2) * (H / 2 - 12);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const nx = pad + (W - 2 * pad) * t, ny = H / 2 - Math.sin(t * Math.PI * 2 - Math.PI / 2) * (H / 2 - 12);
  return (
    <div className="mp-tide" aria-label={`Tide ${tide.tide_phase}, sea level ${tide.sea_level_m?.toFixed(2)} metres`}>
      <div className="mp-tide-head"><Waves /><span>Tide · {tide.tide_phase}</span><em>{tide.sea_level_m?.toFixed(2)} m</em></div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <line x1={pad} x2={W - pad} y1={H / 2} y2={H / 2} className="mp-tide-mid" />
        <polyline points={pts.join(' ')} className="mp-tide-line" />
        <circle cx={nx} cy={ny} r="5" className="mp-tide-dot" />
      </svg>
      <div className="mp-tide-foot"><span>Low</span><span>High</span><span>Low</span></div>
    </div>
  );
}

const vis = (d, ph) => (d === 'peek' ? 136 : d === 'half' ? Math.round(ph * 0.52) : ph);

export default function PlaceSheet({ loc, state, data, onClose, onRetry, onOpen, mobile, parentH, onDetent }) {
  const { depth, weather, tide } = data || {};
  const { has, toggle } = useWatchlist();
  const [toast, setToast] = useState(null);
  const [detent, setDetent] = useState('half');
  const drag = useDragControls();
  const ac = useAnimationControls();
  const justDragged = useRef(false);
  const H = Math.max(320, (parentH || 700) - 64 - 58); // 58 = mobile tab bar
  const yFor = useCallback((d) => H - Math.min(H, vis(d, H)), [H]);
  const starred = loc.digipin ? has(loc.digipin) : false;
  const signed = (n, d = 2) => (n == null ? '—' : `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(d)} m`);

  useEffect(() => { if (mobile) { ac.start({ y: yFor(detent) }, spring); onDetent?.(detent, vis(detent, H)); } }, [mobile, detent, yFor]); // eslint-disable-line
  useEffect(() => { if (!toast) return undefined; const t = setTimeout(() => setToast(null), 1800); return () => clearTimeout(t); }, [toast]);

  const snap = (_, info) => {
    justDragged.current = true; setTimeout(() => { justDragged.current = false; }, 80);
    const y = yFor(detent) + info.offset.y + info.velocity.y * 0.22;
    if (info.offset.y > 0 && yFor(detent) + info.offset.y > yFor('peek') + 70 && info.velocity.y > 400) { onClose(); return; }
    const order = ['full', 'half', 'peek'];
    const next = order.reduce((b, d) => (Math.abs(yFor(d) - y) < Math.abs(yFor(b) - y) ? d : b), 'half');
    ac.start({ y: yFor(next) }, spring);
    setDetent(next);
  };
  const cycle = () => !justDragged.current && setDetent((d) => (d === 'peek' ? 'half' : d === 'half' ? 'full' : 'peek'));

  const share = async () => {
    if (!loc.digipin) return;
    const url = `${window.location.origin}/location/${loc.digipin}`;
    try { await navigator.clipboard.writeText(url); setToast('Copied'); }
    catch {
      try {
        const ta = document.createElement('textarea'); ta.value = url; document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); ta.remove(); setToast('Copied');
      } catch { setToast('Couldn’t copy'); }
    }
  };
  const star = () => loc.digipin && toggle({ digipin: loc.digipin, name: loc.name, lat: loc.lat, lon: loc.lon, type: loc.type, region: loc.region });

  const body = (
    <>
      <div className="mp-meta">
        <Badge tone={TYPE_BADGE[loc.type]}>{loc.type}</Badge>
        {loc.digipin && <span className="mono">{loc.digipin}</span>}
        <span><MapPin size={11} style={{ verticalAlign: -1 }} /> {loc.lat.toFixed(3)}°N, {loc.lon.toFixed(3)}°E</span>
      </div>
      {state === 'error' ? (
        <div className="mp-err" role="alert">
          <p>Couldn’t load live conditions for this spot right now.</p>
          <button className="btn tinted" onClick={onRetry}>Retry</button>
        </div>
      ) : state === 'loading' ? (
        <>
          <div className="mp-hero"><div className="lbl">Current depth</div><div className="skeleton" style={{ height: 52, width: 170, marginTop: 8, borderRadius: 12 }} /></div>
          <div className="mp-grid">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 52, borderRadius: 12 }} />)}</div>
          <div className="mp-inset">{[0, 1, 2, 3].map((i) => <div key={i} className="mp-row"><div className="skeleton" style={{ height: 14, width: '100%' }} /></div>)}</div>
          <div className="mp-note">Fetching live depth model… this can take a few seconds.</div>
        </>
      ) : (
        <>
          {depth && (
            <>
              <div className="mp-hero">
                <div className="lbl">Current depth</div>
                <div className="num"><CountUp value={depth.computed_depth} /><small>m</small></div>
              </div>
              <div className="mp-grid">
                <Cell label="Base depth" value={fmtM(depth.base_depth)} />
                <Cell label="Tide" value={signed(depth.tidal_offset)} />
                <Cell label="Rainfall" value={signed(depth.rainfall_impact)} />
                <Cell label="Confidence" value={`${Math.round((depth.confidence ?? 0) * 100)}%`} />
              </div>
            </>
          )}
          {tide && loc.type === 'ocean' && <TideArc tide={tide} />}
          {weather && (
            <div className="mp-inset">
              <div className="mp-row"><Thermometer />Temperature<em>{weather.temperature_c?.toFixed(1)}°C</em></div>
              <div className="mp-row"><CloudRain />Rainfall<em>{weather.precipitation_mm?.toFixed(1)} mm</em></div>
              <div className="mp-row"><Wind />Wind<em>{weather.wind_speed_ms?.toFixed(1)} m/s</em></div>
              <div className="mp-row"><Droplets />Humidity<em>{weather.humidity_pct?.toFixed(0)}%</em></div>
              {tide && loc.type === 'ocean' && <div className="mp-row"><Waves />Waves<em>{tide.wave_height_m?.toFixed(1)} m</em></div>}
            </div>
          )}
          {!depth && !weather && <div className="mp-note">No live data available for this location.</div>}
        </>
      )}
      <button className="btn block" onClick={onOpen} disabled={!loc.digipin}>View full analysis <ChevronRight size={18} /></button>
    </>
  );

  const head = (
    <div className="mp-head" onPointerDown={mobile ? (e) => { if (!e.target.closest('button')) drag.start(e); } : undefined}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="mp-title">{loc.name}</div>
        <div className="mp-sub">{[loc.region, loc.type].filter(Boolean).join(' · ')}</div>
        {mobile && depth && state === 'ready' && <div className="mp-peek">Depth <b>{depth.computed_depth?.toFixed(2)} m</b></div>}
      </div>
      <div className="mp-actions">
        <button className={`mp-ico ${starred ? 'on' : ''}`} aria-label={starred ? 'Remove from watchlist' : 'Add to watchlist'} aria-pressed={starred} onClick={star} disabled={!loc.digipin}>
          <Star fill={starred ? 'currentColor' : 'none'} />
        </button>
        <button className="mp-ico" aria-label="Copy share link" onClick={share} disabled={!loc.digipin}><Share /></button>
        <button className="mp-ico" aria-label="Close details" onClick={onClose}><X /></button>
      </div>
    </div>
  );

  const toastEl = (
    <AnimatePresence>
      {toast && (
        <motion.div className="mp-toast" role="status" initial={{ opacity: 0, y: 8, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }} transition={spring}>{toast}</motion.div>
      )}
    </AnimatePresence>
  );

  if (!mobile) {
    return (
      <motion.aside className="map-panel material" role="dialog" aria-label={`Details for ${loc.name}`}
        initial={{ opacity: 0, x: 28, scale: 0.98 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: 28, scale: 0.98 }} transition={spring}>
        {head}{body}{toastEl}
      </motion.aside>
    );
  }
  return (
    <motion.aside className="map-panel sheet material" role="dialog" aria-label={`Details for ${loc.name}`} data-detent={detent}
      style={{ height: H }} initial={{ y: H + 40 }} animate={ac} exit={{ y: H + 40, transition: { duration: 0.25 } }}
      drag="y" dragControls={drag} dragListener={false} dragConstraints={{ top: 0, bottom: H }} dragElastic={0.06} dragMomentum={false} onDragEnd={snap}>
      <button className="sheet-grab" aria-label={`Resize sheet (currently ${detent})`} onPointerDown={(e) => drag.start(e)} onClick={cycle}><i /></button>
      {head}
      <div className="sheet-body" style={{ overflowY: detent === 'full' ? 'auto' : 'hidden' }}>{body}</div>
      {toastEl}
    </motion.aside>
  );
}
