import { useSyncExternalStore, useCallback } from 'react';

/** Shared watchlist store (localStorage). Item: { digipin, name, lat, lon, type, region }.
 *  Usage:  const { items, has, toggle, remove, replaceAll } = useWatchlist();  */
const KEY = 'aquadepth-watchlist';
let cache = null;
const listeners = new Set();

function read() {
  if (cache) return cache;
  try { cache = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { cache = []; }
  if (!Array.isArray(cache)) cache = [];
  return cache;
}
function write(next) {
  cache = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode */ }
  listeners.forEach((l) => l());
}
const subscribe = (cb) => {
  listeners.add(cb);
  const onStorage = (e) => { if (e.key === KEY) { cache = null; cb(); } };
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(cb); window.removeEventListener('storage', onStorage); };
};

export function useWatchlist() {
  const items = useSyncExternalStore(subscribe, read, () => []);
  const has = useCallback((digipin) => items.some((i) => i.digipin === digipin), [items]);
  const toggle = useCallback((item) => {
    const cur = read();
    write(cur.some((i) => i.digipin === item.digipin) ? cur.filter((i) => i.digipin !== item.digipin) : [...cur, item]);
  }, []);
  const remove = useCallback((digipin) => write(read().filter((i) => i.digipin !== digipin)), []);
  const replaceAll = useCallback((next) => write(Array.isArray(next) ? next : []), []);
  return { items, has, toggle, remove, replaceAll };
}

/** Encode / decode a shareable list for `?share=` links (compact, URL-safe). */
export const encodeShare = (items) => btoa(unescape(encodeURIComponent(JSON.stringify(items.map(({ digipin, name, lat, lon, type, region }) => ({ digipin, name, lat, lon, type, region })))))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const decodeShare = (s) => { try { return JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))))); } catch { return null; } };
