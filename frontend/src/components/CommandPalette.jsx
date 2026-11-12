import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Map, TrendingUp, AlertTriangle, BarChart3, Compass, Star, GitCompare, LifeBuoy, BrainCircuit, ShieldCheck, Database, Code, MapPin, Sun, Moon, SunMoon, BookOpen } from 'lucide-react';
import { useTheme } from '../lib/theme';
import { useWatchlist } from '../lib/watchlist';
import { searchPlaces, toItem } from '../services/api_tools';
import { startPolling } from '../lib/notify';
import './tools/tools.css';

const PAGES = [
  ['/', 'Map', Map, 'var(--blue)'], ['/forecast', 'Forecast', TrendingUp, 'var(--indigo)'], ['/alerts', 'Alerts', AlertTriangle, 'var(--red)'],
  ['/analytics', 'Insights', BarChart3, 'var(--purple)'], ['/locations', 'Locations', Compass, 'var(--teal)'], ['/watchlist', 'Watchlist', Star, 'var(--orange)'],
  ['/compare', 'Compare', GitCompare, 'var(--green)'], ['/safety', 'Safety', LifeBuoy, 'var(--red)'], ['/ml-lab', 'ML Lab', BrainCircuit, 'var(--indigo)'],
  ['/validation', 'Validation', ShieldCheck, 'var(--green)'], ['/data-sources', 'Data Sources', Database, 'var(--teal)'], ['/developers', 'Developers', Code, 'var(--blue)'],
];
const isTyping = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [places, setPlaces] = useState([]);
  const nav = useNavigate();
  const theme = useTheme();
  const { items: watch } = useWatchlist();
  const inputRef = useRef(null);
  const dialogRef = useRef(null);
  const lastFocus = useRef(null);

  useEffect(() => { startPolling(); }, []);

  const close = useCallback(() => { setOpen(false); setQ(''); setPlaces([]); setSel(0); lastFocus.current?.focus?.(); }, []);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); lastFocus.current = document.activeElement; setOpen((o) => !o); }
      else if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !isTyping(document.activeElement)) { e.preventDefault(); lastFocus.current = document.activeElement; setOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 30); }, [open]);

  useEffect(() => {
    const term = q.trim();
    if (!open || term.length < 2) { setPlaces([]); return undefined; }
    let live = true;
    const t = setTimeout(() => {
      searchPlaces(term, '', 5).then((d) => live && setPlaces((d.locations || []).map((r) => ({ r, item: toItem(r, d.matched_city) })))).catch(() => live && setPlaces([]));
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [q, open]);

  const groups = useMemo(() => {
    const term = q.trim().toLowerCase();
    const m = (s) => !term || s.toLowerCase().includes(term);
    const go = (path) => () => nav(path);
    const g = [];
    const pages = PAGES.filter(([, l]) => m(l)).map(([to, label, icon, color]) => ({ id: `p${to}`, label, icon, color, run: go(to) }));
    if (pages.length) g.push({ title: 'Pages', items: pages });
    if (places.length) g.push({ title: 'Places', items: places.map(({ r, item }) => ({ id: `l${r.digipin}`, label: item.name, sub: `${r.region} · ${r.water_body_type}`, icon: MapPin, color: 'var(--blue)', run: go(`/location/${r.digipin}`) })) });
    const w = watch.filter((i) => term && m(i.name)).map((i) => ({ id: `w${i.digipin}`, label: i.name, sub: 'Watchlist', icon: Star, color: 'var(--orange)', run: go(`/location/${i.digipin}`) }));
    if (w.length) g.push({ title: 'Watchlist', items: w });
    const actions = [
      { id: 'a-light', label: 'Theme: Light', icon: Sun, color: 'var(--orange)', run: () => theme.setMode('light') },
      { id: 'a-dark', label: 'Theme: Dark', icon: Moon, color: 'var(--indigo)', run: () => theme.setMode('dark') },
      { id: 'a-auto', label: 'Theme: Auto', icon: SunMoon, color: 'var(--teal)', run: () => theme.setMode('system') },
      { id: 'a-docs', label: 'Open API docs', icon: BookOpen, color: 'var(--green)', run: () => window.open('/api/docs', '_blank', 'noopener') },
      { id: 'a-ml', label: 'Go to ML Lab', icon: BrainCircuit, color: 'var(--indigo)', run: go('/ml-lab') },
    ].filter((a) => m(a.label) || (term && 'toggle theme'.includes(term)));
    if (actions.length) g.push({ title: 'Actions', items: actions });
    return g;
  }, [q, places, watch, nav, theme]);

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  useEffect(() => { setSel(0); }, [q, places.length]);
  useEffect(() => { document.getElementById(`cp-opt-${sel}`)?.scrollIntoView?.({ block: 'nearest' }); }, [sel]);

  const choose = (it) => { close(); it.run(); };
  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => (flat.length ? (s + 1) % flat.length : 0)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => (flat.length ? (s - 1 + flat.length) % flat.length : 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (flat[sel]) choose(flat[sel]); }
    else if (e.key === 'Tab') { e.preventDefault(); inputRef.current?.focus(); } // focus trap: the input is the only tab stop
  };

  let idx = -1;
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="cp-back" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
          <motion.div ref={dialogRef} className="cp" role="dialog" aria-modal="true" aria-label="Command palette" onKeyDown={onKeyDown}
            initial={{ opacity: 0, scale: 0.96, y: -8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }} transition={{ type: 'spring', stiffness: 420, damping: 32 }}>
            <div className="cp-input">
              <Search />
              <input autoFocus ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search pages, places, actions" role="combobox" aria-expanded="true" aria-controls="cp-list" aria-autocomplete="list"
                aria-activedescendant={flat.length ? `cp-opt-${sel}` : undefined} aria-label="Search commands" autoComplete="off" spellCheck={false} />
              <kbd>esc</kbd>
            </div>
            <div className="cp-list" id="cp-list" role="listbox" aria-label="Results">
              {flat.length === 0 && <div className="cp-empty">No results for “{q}”</div>}
              {groups.map((g) => (
                <div key={g.title} role="group" aria-label={g.title}>
                  <div className="cp-group">{g.title}</div>
                  {g.items.map((it) => {
                    idx += 1; const i = idx; const Icon = it.icon;
                    return (
                      <button key={it.id} id={`cp-opt-${i}`} role="option" aria-selected={sel === i} tabIndex={-1} className="cp-item" onMouseMove={() => setSel(i)} onClick={() => choose(it)}>
                        <span className="icon-chip" style={{ background: it.color }}><Icon /></span>
                        <span className="cp-text"><div>{it.label}</div>{it.sub && <div className="cp-sub">{it.sub}</div>}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
            <div className="cp-foot"><span><kbd>↑</kbd> <kbd>↓</kbd> navigate</span><span><kbd>↵</kbd> open</span><span><kbd>esc</kbd> close</span></div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
