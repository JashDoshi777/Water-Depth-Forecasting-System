import { useEffect, useState, useCallback } from 'react';

const KEY = 'aquadepth-theme';
const read = () => { try { return localStorage.getItem(KEY) || 'system'; } catch { return 'system'; } };

export function applyTheme(mode) {
  const el = document.documentElement;
  if (mode === 'light' || mode === 'dark') el.setAttribute('data-theme', mode);
  else el.removeAttribute('data-theme');
}

/** Returns the effective scheme ('light' | 'dark') even when following the system. */
export function effectiveScheme(mode) {
  if (mode === 'light' || mode === 'dark') return mode;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function useTheme() {
  const [mode, setMode] = useState(read);
  const [scheme, setScheme] = useState(() => effectiveScheme(read()));

  useEffect(() => {
    applyTheme(mode);
    setScheme(effectiveScheme(mode));
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onChange = () => setScheme(effectiveScheme(mode));
    mq?.addEventListener?.('change', onChange);
    return () => mq?.removeEventListener?.('change', onChange);
  }, [mode]);

  const set = useCallback((m) => {
    try { localStorage.setItem(KEY, m); } catch { /* private mode */ }
    setMode(m);
  }, []);

  return { mode, scheme, setMode: set };
}

// Apply as early as possible to avoid a flash of the wrong theme.
applyTheme(read());
