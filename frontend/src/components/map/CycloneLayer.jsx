import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { spring } from '../ui';
import { getCycloneSummary, getCycloneTracks } from '../../services/api_map';
import { CYCLONE_CATS, setCycloneData, setCycloneHighlight, setCycloneLabels, setCycloneVisible } from '../../lib/mapStyle';

const catLabel = (k) => CYCLONE_CATS.find((c) => c.key === k)?.label || k;

/** Cyclone track layer + compact control card (year range, intensity legend, storm card). */
export default function CycloneLayer({ map, ready, scheme, active, hidden, onUnavailable }) {
  const [years, setYears] = useState(null);
  const [range, setRange] = useState(null);
  const [count, setCount] = useState(null);
  const [storm, setStorm] = useState(null);
  const [err, setErr] = useState(false);
  const pinned = useRef(null);
  const strongest = useRef([]);
  const schemeRef = useRef(scheme); schemeRef.current = scheme;

  // summary → year bounds
  useEffect(() => {
    if (!active || years) return;
    getCycloneSummary().then((s) => {
      const ys = [...s.years].map(Number).sort((a, b) => a - b);
      setYears(ys); setRange([ys[Math.max(0, ys.length - 6)] ?? ys[0], ys[ys.length - 1]]);
      strongest.current = (s.strongest || []).map((x) => (typeof x === 'string' ? x : x.sid)).filter(Boolean).slice(0, 8);
    }).catch(() => { setErr(true); onUnavailable?.(); });
  }, [active, years]); // eslint-disable-line

  // tracks
  useEffect(() => {
    if (!map || !ready || !active || !range) return undefined;
    let live = true;
    const t = setTimeout(() => {
      getCycloneTracks({ yearFrom: range[0], yearTo: range[1] }).then((fc) => {
        if (!live) return;
        setErr(false); setCount(fc.features.length);
        setCycloneData(map, schemeRef.current, fc);
        setCycloneVisible(map, true);
        const top = strongest.current.length ? strongest.current
          : [...fc.features].sort((a, b) => (b.properties.max_wind_kt || 0) - (a.properties.max_wind_kt || 0)).slice(0, 8).map((f) => f.properties.sid);
        setCycloneLabels(map, top);
      }).catch(() => { if (live) { setErr(true); onUnavailable?.(); } });
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [map, ready, active, range]); // eslint-disable-line

  useEffect(() => { if (map && ready) { setCycloneVisible(map, active); if (!active) { setStorm(null); pinned.current = null; setCycloneHighlight(map, null); } } }, [map, ready, active]);

  // hover / click
  useEffect(() => {
    if (!map || !ready || !active) return undefined;
    const over = (e) => {
      const f = e.features?.[0]; if (!f) return;
      map.getCanvas().style.cursor = 'pointer';
      if (!pinned.current) { setCycloneHighlight(map, f.properties.sid); setStorm(f.properties); }
    };
    const out = () => { map.getCanvas().style.cursor = ''; if (!pinned.current) { setCycloneHighlight(map, null); setStorm(null); } };
    const click = (e) => {
      const f = e.features?.[0]; if (!f) return;
      e.originalEvent.cancelBubble = true;
      pinned.current = f.properties.sid; setCycloneHighlight(map, f.properties.sid); setStorm(f.properties);
    };
    map.on('mousemove', 'cy-hit', over); map.on('mouseleave', 'cy-hit', out); map.on('click', 'cy-hit', click);
    return () => { map.off('mousemove', 'cy-hit', over); map.off('mouseleave', 'cy-hit', out); map.off('click', 'cy-hit', click); };
  }, [map, ready, active, count]);

  const opts = useMemo(() => years || [], [years]);
  if (!active) return null;
  const clear = () => { pinned.current = null; setStorm(null); map && setCycloneHighlight(map, null); };
  const setFrom = (v) => setRange(([, b]) => [Number(v), Math.max(Number(v), b)]);
  const setTo = (v) => setRange(([a]) => [Math.min(a, Number(v)), Number(v)]);

  return (
    <motion.div className="cy-card material" style={hidden ? { display: 'none' } : undefined} role="group" aria-label="Cyclone tracks"
      initial={{ opacity: 0, y: 12, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12 }} transition={spring}>
      <div className="cy-head"><b>Cyclone tracks</b>{count != null && <span>{count} storms</span>}</div>
      {err ? <div className="sc-note" role="status">Cyclone data isn’t available right now.</div> : (
        <>
          <div className="cy-range">
            <label>From<select aria-label="From year" value={range?.[0] ?? ''} disabled={!years} onChange={(e) => setFrom(e.target.value)}>{opts.map((y) => <option key={y} value={y}>{y}</option>)}</select></label>
            <label>To<select aria-label="To year" value={range?.[1] ?? ''} disabled={!years} onChange={(e) => setTo(e.target.value)}>{opts.map((y) => <option key={y} value={y}>{y}</option>)}</select></label>
          </div>
          <div className="cy-legend" aria-label="Cyclone intensity legend">
            {CYCLONE_CATS.map((c) => <span key={c.key} title={c.label}><i style={{ background: c.color, height: Math.max(2, c.w + 0.5) }} />{c.key}</span>)}
          </div>
          <div className="cy-legend-sub">Depression → Super cyclonic storm</div>
        </>
      )}
      {storm && (
        <div className="cy-storm" aria-live="polite">
          <button className="mp-ico" aria-label="Dismiss storm" onClick={clear}><X /></button>
          <div className="cy-name">{storm.name || 'Unnamed'} <small>{storm.year}</small></div>
          <div className="cy-cat">{catLabel(storm.category)}</div>
          <div className="cy-facts"><span>Peak wind <b>{storm.max_wind_kt ?? '—'} kt</b></span><span>Min pressure <b>{storm.min_pressure_hpa ?? '—'} hPa</b></span></div>
        </div>
      )}
    </motion.div>
  );
}
