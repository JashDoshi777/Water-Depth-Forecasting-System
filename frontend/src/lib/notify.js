import { useEffect, useState, useSyncExternalStore } from 'react';
import { floodNow } from '../services/api_tools';

/** Opt-in risk notifications. No push server: this only works while the app is open. */
const PREF = 'aquadepth-notify';
const LAST = 'aquadepth-risk-last';
const RANK = { none: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const listeners = new Set();
let banners = [];
let timer = null;

const emit = () => listeners.forEach((l) => l());
const readJSON = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || ''); } catch { return d; } };

export const isSupported = () => typeof window !== 'undefined' && 'Notification' in window;
export const permission = () => (isSupported() ? Notification.permission : 'unsupported');
export const isEnabled = () => { try { return localStorage.getItem(PREF) === '1' && permission() === 'granted'; } catch { return false; } };

/** Call from a click handler only: asks for permission, then stores the preference. */
export async function enable() {
  if (!isSupported()) return 'unsupported';
  let p = Notification.permission;
  if (p === 'default') p = await Notification.requestPermission();
  try { localStorage.setItem(PREF, p === 'granted' ? '1' : '0'); } catch { /* ignore */ }
  emit();
  return p;
}
export function disable() { try { localStorage.setItem(PREF, '0'); } catch { /* ignore */ } emit(); }

export const dismissBanner = (digipin) => { banners = banners.filter((b) => b.digipin !== digipin); emit(); };

/** Compare a freshly seen level with the last one for this place; alert if it rose to moderate+. */
export function evaluate(item, level) {
  if (!(level in RANK)) return;
  const last = readJSON(LAST, {}) || {};
  const prev = last[item.digipin];
  last[item.digipin] = level;
  try { localStorage.setItem(LAST, JSON.stringify(last)); } catch { /* ignore */ }
  if (prev == null || !(prev in RANK)) return; // first sighting: baseline only
  if (RANK[level] >= RANK.moderate && RANK[level] > RANK[prev]) {
    banners = [...banners.filter((b) => b.digipin !== item.digipin), { digipin: item.digipin, name: item.name, from: prev, to: level }];
    emit();
    if (isEnabled()) {
      try { new Notification(`Flood risk rose: ${item.name}`, { body: `Now ${level} (was ${prev}). Open AquaDepth for details.`, tag: `risk-${item.digipin}` }); } catch { /* ignore */ }
    }
  }
}

export async function checkNow(items) {
  await Promise.all(items.map(async (it) => {
    try { const f = await floodNow(it.digipin, true); evaluate(it, f.level); } catch { /* upstream hiccup: skip */ }
  }));
}

const readWatch = () => readJSON('aquadepth-watchlist', []) || [];

/** Start the 5-minute poller (idempotent). Runs while the app is open. */
export function startPolling() {
  if (timer || typeof window === 'undefined') return;
  timer = setInterval(() => { if (isEnabled() && navigator.onLine) checkNow(readWatch()); }, 5 * 60 * 1000);
}

export function useRiskBanners() {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => banners, () => banners);
}

export function useNotifyState() {
  const [, force] = useState(0);
  useEffect(() => { const l = () => force((n) => n + 1); listeners.add(l); return () => listeners.delete(l); }, []);
  return { supported: isSupported(), permission: permission(), enabled: isEnabled() };
}

export function useOnline() {
  const [on, setOn] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const u = () => setOn(true), d = () => setOn(false);
    window.addEventListener('online', u); window.addEventListener('offline', d);
    return () => { window.removeEventListener('online', u); window.removeEventListener('offline', d); };
  }, []);
  return on;
}
