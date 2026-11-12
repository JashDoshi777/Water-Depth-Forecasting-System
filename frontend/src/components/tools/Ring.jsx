import React from 'react';
import { motion } from 'framer-motion';

/** Progress ring. value 0..1, children = centre label. */
export default function Ring({ value = 0, color = 'var(--blue)', size = 64, stroke = 7, children, label }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, v = Math.max(0, Math.min(1, value));
  return (
    <div className="ring" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--fill-3)" strokeWidth={stroke} />
        <motion.circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - v) }} transform={`rotate(-90 ${size / 2} ${size / 2})`}
          transition={{ type: 'spring', stiffness: 70, damping: 18 }} />
      </svg>
      <div className="ring-c">{children}</div>
    </div>
  );
}

/** Tiny dependency-free sparkline. */
export function Spark({ values, color = 'var(--blue)', width = 120, height = 36, label = 'Forecast trend' }) {
  if (!values || values.length < 2) return <div style={{ width, height }} />;
  const lo = Math.min(...values), hi = Math.max(...values), span = Math.max(hi - lo, 0.02);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * (width - 4) + 2, height - 4 - ((v - lo) / span) * (height - 8)]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="spark">
      <path d={`${d} L${last[0]},${height} L2,${height} Z`} fill={color} opacity="0.12" />
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="2.6" fill={color} />
    </svg>
  );
}
