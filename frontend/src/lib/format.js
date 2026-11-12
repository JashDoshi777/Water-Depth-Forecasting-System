export const fmtNum = (n, d = 0) => (n == null || Number.isNaN(n) ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d }));
export const fmtCompact = (n) => {
  if (n == null) return '—';
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
};
export const fmtM = (n, d = 1) => (n == null || Number.isNaN(n) ? '—' : `${Number(n).toFixed(d)} m`);
export const fmtTime = (iso, opts) => (iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', ...opts }) : '—');
export const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
export const TYPE_COLOR = { ocean: 'var(--blue)', river: 'var(--teal)', lake: 'var(--green)', reservoir: 'var(--purple)' };
export const TYPE_BADGE = { ocean: 'blue', river: 'teal', lake: 'green', reservoir: 'purple' };
export const LEVEL_BADGE = { none: 'green', low: 'green', moderate: 'yellow', high: 'orange', critical: 'red' };
export const LEVEL_COLOR = { none: 'var(--green)', low: 'var(--green)', moderate: 'var(--yellow)', high: 'var(--orange)', critical: 'var(--red)' };
