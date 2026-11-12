import React, { useEffect, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';
import { SearchField, Badge } from '../ui';
import { TYPE_BADGE } from '../../lib/format';
import { searchPlaces, toItem } from '../../services/api_tools';
import './tools.css';

/** Debounced place search with an inline results list. onPick receives a watchlist-shaped item. */
export default function PlaceSearch({ onPick, placeholder = 'Search places or cities', type = '', exclude = [], autoFocus }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setRes(null); setErr(false); return undefined; }
    const my = ++seq.current;
    setBusy(true);
    const t = setTimeout(() => {
      searchPlaces(term, type, 8).then((d) => {
        if (my !== seq.current) return;
        setRes({ city: d.matched_city, rows: d.locations || [] }); setErr(false); setBusy(false);
      }).catch(() => { if (my === seq.current) { setErr(true); setBusy(false); } });
    }, 250);
    return () => clearTimeout(t);
  }, [q, type]);

  const rows = (res?.rows || []).filter((r) => !exclude.includes(r.digipin));
  return (
    <div className="ps">
      <SearchField value={q} onChange={setQ} placeholder={placeholder} autoFocus={autoFocus} />
      {q.trim().length >= 2 && (
        <div className="ps-pop list" role="listbox" aria-label="Search results">
          {busy && !res && <div className="ps-note">Searching…</div>}
          {err && <div className="ps-note">Search is unavailable right now. Try again in a moment.</div>}
          {!busy && !err && res && !rows.length && <div className="ps-note">No matching water bodies.</div>}
          {rows.map((r) => (
            <button key={r.digipin} role="option" aria-selected="false" className="list-row ps-row" onClick={() => { onPick(toItem(r, res.city), r); setQ(''); setRes(null); }}>
              <MapPin size={16} style={{ color: 'var(--blue)', flexShrink: 0 }} />
              <div className="list-main">
                <div className="list-title">{res.city ? `${res.city} · ${r.name}` : r.name}</div>
                <div className="list-detail">{r.region}{r.distance_km != null && res.city ? ` · ${r.distance_km} km away` : ''} · <span className="mono">{r.digipin}</span></div>
              </div>
              <Badge tone={TYPE_BADGE[r.water_body_type]}>{r.water_body_type}</Badge>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
