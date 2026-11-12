import React, { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { spring } from '../ui';

export const WB_LAYERS = [
  { key: 'all', label: 'All', color: null },
  { key: 'ocean', label: 'Ocean', color: 'var(--blue)' },
  { key: 'river', label: 'Rivers', color: 'var(--teal)' },
  { key: 'lake', label: 'Lakes', color: 'var(--green)' },
  { key: 'reservoir', label: 'Reservoirs', color: 'var(--purple)' },
];

function Seg({ label, options, value, onChange }) {
  return (
    <div className="ls-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} className={value === o.value ? 'active' : ''} aria-pressed={value === o.value}
          disabled={o.disabled} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

function Toggle({ label, desc, checked, onChange, disabled, color }) {
  return (
    <button className="ls-toggle" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}>
      <span className="ls-dot" style={{ background: color }} />
      <span className="ls-tt"><b>{label}</b><small>{disabled ? 'Not available right now' : desc}</small></span>
      <span className="ls-sw" />
    </button>
  );
}

export default function LayersSheet({ filter, setFilter, forecast, setForecast, cyclones, setCyclones, survey, setSurvey, mapStyle, setMapStyle, avail, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', h, true);
    ref.current?.focus();
    return () => window.removeEventListener('keydown', h, true);
  }, [onClose]);
  return (
    <motion.div ref={ref} tabIndex={-1} className="layers-sheet material" role="dialog" aria-label="Map layers"
      initial={{ opacity: 0, scale: 0.94, y: -8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: -6 }} transition={spring}>
      <div className="ls-head"><span>Layers</span><button className="mp-ico" aria-label="Close layers" onClick={onClose}><X /></button></div>

      <div className="ls-group">
        <div className="ls-title">Water bodies</div>
        <div className="ls-chips" role="group" aria-label="Water bodies">
          {WB_LAYERS.map((l) => (
            <button key={l.key} className={filter === l.key ? 'active' : ''} aria-pressed={filter === l.key} aria-label={`Show ${l.label}`} onClick={() => setFilter(l.key)}>
              <span className={`swatch ${l.key === 'all' ? 'all' : ''}`} style={l.color ? { background: l.color } : undefined} />{l.label}
            </button>
          ))}
        </div>
      </div>

      <div className="ls-group">
        <div className="ls-title">Overlays</div>
        <div className="ls-row"><span>Forecast</span>
          <Seg label="Forecast overlay" value={forecast} onChange={setForecast}
            options={[{ value: 'off', label: 'Off' }, { value: 'rain', label: 'Rain', disabled: !avail.forecast }, { value: 'wave', label: 'Waves', disabled: !avail.forecast }, { value: 'wind', label: 'Wind', disabled: !avail.forecast }]} />
        </div>
        <Toggle label="Cyclones" desc="Historical tracks by intensity" checked={cyclones} onChange={setCyclones} disabled={!avail.cyclones} color="#c8645a" />
        <Toggle label="Survey priority" desc="Where the depth model is least certain" checked={survey} onChange={setSurvey} disabled={!avail.survey} color="#c77d1e" />
      </div>

      <div className="ls-group">
        <div className="ls-title">Map style</div>
        <Seg label="Map style" value={mapStyle} onChange={setMapStyle}
          options={[{ value: 'auto', label: 'Auto' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
      </div>
    </motion.div>
  );
}
