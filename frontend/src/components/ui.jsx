import React from 'react';
import { motion } from 'framer-motion';
import { Search, X, ChevronRight, Loader } from 'lucide-react';

export const spring = { type: 'spring', stiffness: 380, damping: 34, mass: 0.9 };
export const fadeUp = { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.35, ease: [0.32, 0.72, 0, 1] } };

/** iOS large-title page header. `right` is an optional trailing control. */
export function PageHeader({ title, subtitle, right }) {
  return (
    <header className="page-head">
      <div>
        <h1 className="large-title">{title}</h1>
        {subtitle && <p className="page-sub">{subtitle}</p>}
      </div>
      {right}
    </header>
  );
}

export function Card({ children, className = '', flush, interactive, onClick, style, ...rest }) {
  return (
    <div className={`card ${flush ? 'flush' : ''} ${interactive ? 'interactive' : ''} ${className}`} onClick={onClick} style={style} {...rest}>
      {children}
    </div>
  );
}

export function CardTitle({ icon: Icon, color = 'var(--blue)', children, sub }) {
  return (
    <>
      <div className="card-title">{Icon && <Icon size={16} style={{ color }} />}{children}</div>
      {sub && <div className="card-sub">{sub}</div>}
    </>
  );
}

/** Health-style stat tile. */
export function Stat({ label, value, unit, foot, icon: Icon, color = 'var(--blue)', loading }) {
  return (
    <Card className="stat">
      <div className="stat-label">{Icon && <Icon style={{ color }} />}{label}</div>
      {loading ? <div className="skeleton" style={{ height: 30, width: '60%' }} /> :
        <div className="stat-value">{value}{unit && <small>{unit}</small>}</div>}
      {foot && <div className="stat-foot">{foot}</div>}
    </Card>
  );
}

export function Segmented({ options, value, onChange, full, label }) {
  return (
    <div className={`segmented ${full ? 'full' : ''}`} role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value} className={value === o.value ? 'active' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SearchField({ value, onChange, placeholder = 'Search', onFocus, autoFocus }) {
  return (
    <label className="search">
      <Search />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} onFocus={onFocus} autoFocus={autoFocus} aria-label={placeholder} />
      {value && (
        <button className="clear" aria-label="Clear" onClick={(e) => { e.preventDefault(); onChange(''); }}><X /></button>
      )}
    </label>
  );
}

export function Badge({ tone = '', children }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function IconChip({ icon: Icon, color = 'var(--blue)', lg }) {
  return <span className={`icon-chip ${lg ? 'lg' : ''}`} style={{ background: color }}><Icon /></span>;
}

export function List({ children, className = '', ...rest }) {
  return <div className={`list ${className}`} {...rest}>{children}</div>;
}

export function ListRow({ icon, iconColor, title, detail, value, onClick, chevron, children, ...rest }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag className="list-row" onClick={onClick} {...rest}>
      {icon && <IconChip icon={icon} color={iconColor} />}
      <div className="list-main">
        <div className="list-title">{title}</div>
        {detail && <div className="list-detail">{detail}</div>}
      </div>
      {children}
      {value != null && <div className="list-value">{value}</div>}
      {(chevron || onClick) && <ChevronRight className="chev" />}
    </Tag>
  );
}

export function Loading({ label = 'Loading…' }) {
  return <div className="center-state" role="status"><div className="spinner" /><span>{label}</span></div>;
}

export function EmptyState({ icon: Icon, title, children, action }) {
  return (
    <div className="center-state">
      {Icon && <Icon className="big" />}
      <h3>{title}</h3>
      {children && <p style={{ maxWidth: 380 }}>{children}</p>}
      {action}
    </div>
  );
}

export function Sheet({ open, onClose, children, title }) {
  if (!open) return null;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <motion.div className="sheet" onClick={(e) => e.stopPropagation()} initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={spring} role="dialog" aria-label={title}>
        <div className="sheet-grab" />
        {children}
      </motion.div>
    </div>
  );
}

/** Recharts tooltip in the system material style. */
export function ChartTip({ active, payload, label, unit = '', digits = 2, labelFormatter }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tip">
      <b>{labelFormatter ? labelFormatter(label) : label}</b>
      {payload.filter((p) => p.value != null && !String(p.dataKey).startsWith('_')).map((p, i) => (
        <div key={i} style={{ color: 'var(--label-2)' }}>
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: p.stroke || p.fill || p.color, marginRight: 6 }} />
          {p.name}: <span style={{ color: 'var(--label)', fontWeight: 600 }} className="tnum">{typeof p.value === 'number' ? p.value.toFixed(digits) : p.value}{unit}</span>
        </div>
      ))}
    </div>
  );
}

export { Loader };
