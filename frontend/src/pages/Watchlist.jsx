import React, { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Star, Share2, Download, Bell, X, Plus, AlertTriangle, Search } from 'lucide-react';
import { PageHeader, Card, Badge, Sheet, EmptyState, ListRow, List, spring } from '../components/ui';
import PlaceSearch from '../components/tools/PlaceSearch';
import Ring, { Spark } from '../components/tools/Ring';
import OfflineBanner from '../components/tools/OfflineBanner';
import { useWatchlist, encodeShare, decodeShare } from '../lib/watchlist';
import { TYPE_BADGE, LEVEL_BADGE, LEVEL_COLOR } from '../lib/format';
import { depthNow, forecast48, floodNow } from '../services/api_tools';
import { downloadCSV, stamp } from '../lib/export';
import * as notify from '../lib/notify';
import '../components/tools/tools.css';
import './Watchlist.css';

function WatchCard({ item, onRemove }) {
  const [s, setS] = useState({ depth: undefined, fc: undefined, risk: undefined });
  useEffect(() => {
    let live = true;
    const set = (k) => (v) => live && setS((p) => ({ ...p, [k]: v }));
    depthNow(item.digipin).then(set('depth'), () => set('depth')(null));
    forecast48(item.digipin).then(set('fc'), () => set('fc')(null));
    floodNow(item.digipin).then((r) => { set('risk')(r); notify.evaluate(item, r.level); }, () => set('risk')(null));
    return () => { live = false; };
  }, [item.digipin]); // eslint-disable-line react-hooks/exhaustive-deps

  const { depth, fc, risk } = s;
  const series = fc ? fc.forecast.slice(0, 24).map((f) => f.predicted_depth) : null;
  const delta = fc && depth ? fc.forecast[23].predicted_depth - depth.computed_depth : null;
  const lvl = risk?.level || 'none';
  return (
    <motion.article layout initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={spring} className="card wl-card" aria-label={item.name} data-testid="watch-card">
      <div className="wl-top">
        <div className="wl-name">
          <Link to={`/location/${item.digipin}`} className="wl-title">{item.name}</Link>
          <div className="wl-meta"><Badge tone={TYPE_BADGE[item.type]}>{item.type}</Badge><span>{item.region}</span></div>
        </div>
        <button className="wl-x" aria-label={`Remove ${item.name} from watchlist`} onClick={() => onRemove(item.digipin)}><X size={15} /></button>
      </div>
      <div className="wl-mid">
        <div>
          <div className="wl-lbl">Current depth</div>
          {depth === undefined ? <div className="skeleton" style={{ height: 40, width: 110 }} /> :
            depth ? <div className="wl-big tnum" data-testid="watch-depth">{depth.computed_depth.toFixed(1)}<small>m</small></div> :
              <div className="wl-na">Unavailable</div>}
        </div>
        {risk === undefined ? <div className="skeleton" style={{ width: 64, height: 64, borderRadius: 32 }} /> :
          risk ? (
            <Ring value={risk.probability} color={LEVEL_COLOR[lvl]} label={`Flood probability ${Math.round(risk.probability * 100)} percent, ${lvl} risk`}>
              {Math.round(risk.probability * 100)}<small style={{ fontSize: 10, color: 'var(--label-2)' }}>%</small>
            </Ring>
          ) : <div className="wl-na">Risk n/a</div>}
      </div>
      <div className="wl-bot">
        <div>
          {fc === undefined ? <div className="skeleton" style={{ height: 36, width: 120 }} /> :
            series ? <Spark values={series} color="var(--blue)" label={`24 hour depth forecast for ${item.name}`} /> : <div className="wl-na">Forecast n/a</div>}
          <div className="wl-lbl" style={{ marginTop: 2 }}>Next 24 h{delta != null && <span className="tnum"> · {delta >= 0 ? '+' : '−'}{Math.abs(delta).toFixed(2)} m</span>}</div>
        </div>
        {risk && <Badge tone={LEVEL_BADGE[lvl]}>{lvl === 'none' ? 'No risk' : `${lvl} risk`}</Badge>}
      </div>
    </motion.article>
  );
}

export default function Watchlist() {
  const { items, toggle, remove, replaceAll } = useWatchlist();
  const [params, setParams] = useSearchParams();
  const [toast, setToast] = useState('');
  const [importing, setImporting] = useState(null);
  const [busy, setBusy] = useState(false);
  const online = notify.useOnline();
  const nstate = notify.useNotifyState();
  const banners = notify.useRiskBanners();
  const [denied, setDenied] = useState(false);
  const tRef = useRef();

  const flash = (m) => { setToast(m); clearTimeout(tRef.current); tRef.current = setTimeout(() => setToast(''), 1800); };

  useEffect(() => {
    const sh = params.get('share');
    if (!sh) return;
    const list = decodeShare(sh);
    if (Array.isArray(list) && list.length) setImporting(list.filter((x) => x && x.digipin && x.name));
    else flash('That share link is not valid');
    const next = new URLSearchParams(params); next.delete('share'); setParams(next, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const share = async () => {
    const url = `${window.location.origin}/watchlist?share=${encodeShare(items)}`;
    try { await navigator.clipboard.writeText(url); flash('Link copied'); } catch { window.prompt?.('Copy this link', url); flash('Link ready to copy'); }
  };
  const confirmImport = () => {
    const have = new Set(items.map((i) => i.digipin));
    replaceAll([...items, ...importing.filter((i) => !have.has(i.digipin))]);
    flash(`Imported ${importing.length} places`); setImporting(null);
  };
  const exportCSV = async () => {
    setBusy(true);
    const rows = await Promise.all(items.map(async (it) => {
      const [d, r] = await Promise.allSettled([depthNow(it.digipin), floodNow(it.digipin)]);
      return { it, d: d.value, r: r.value };
    }));
    downloadCSV(`aquadepth-watchlist-${stamp()}.csv`, rows, [
      { label: 'Name', get: (x) => x.it.name }, { label: 'DIGIPIN', get: (x) => x.it.digipin }, { label: 'Type', get: (x) => x.it.type },
      { label: 'Region', get: (x) => x.it.region }, { label: 'Latitude', get: (x) => x.it.lat }, { label: 'Longitude', get: (x) => x.it.lon },
      { label: 'Current depth (m)', get: (x) => x.d?.computed_depth }, { label: 'Tide offset (m)', get: (x) => x.d?.tidal_offset },
      { label: 'Flood probability', get: (x) => x.r?.probability }, { label: 'Flood risk level', get: (x) => x.r?.level },
    ]);
    setBusy(false);
  };
  const toggleNotify = async () => {
    if (nstate.enabled) { notify.disable(); return; }
    const p = await notify.enable();
    setDenied(p !== 'granted');
    if (p === 'granted') notify.checkNow(items);
  };

  return (
    <div className="page">
      <PageHeader title="Watchlist" subtitle="Your pinned places at a glance — live depth, 24 h trend and flood risk."
        right={items.length > 0 && (
          <div className="pg-actions">
            <button className="btn gray" onClick={share}><Share2 size={15} />Share</button>
            <button className="btn gray" onClick={exportCSV} disabled={busy}><Download size={15} />Export CSV</button>
          </div>
        )} />
      <OfflineBanner />
      {!online && <p className="wl-foot" style={{ marginTop: -6 }}>Depth and forecast values may be from your last visit.</p>}
      {banners.map((b) => (
        <div key={b.digipin} className="tl-banner warn" role="alert" data-testid="risk-banner">
          <AlertTriangle size={16} /><span><b>{b.name}</b>: flood risk rose from {b.from} to {b.to}.</span>
          <button onClick={() => notify.dismissBanner(b.digipin)}>Dismiss</button>
        </div>
      ))}

      <div className="wl-add"><PlaceSearch placeholder="Add a place — search by name or city" exclude={items.map((i) => i.digipin)} onPick={(it) => { toggle(it); flash(`Added ${it.name}`); }} /></div>

      {items.length === 0 ? (
        <Card><EmptyState icon={Star} title="No places yet" action={<Link to="/" className="btn tinted"><Search size={15} />Find places</Link>}>
          Pin places from the map or search above to see them here as live cards.
        </EmptyState></Card>
      ) : (
        <div className="wl-grid"><AnimatePresence>{items.map((it) => <WatchCard key={it.digipin} item={it} onRemove={remove} />)}</AnimatePresence></div>
      )}

      <div className="section-title">Notifications</div>
      <List>
        <ListRow icon={Bell} iconColor="var(--red)" title="Warn me when risk rises"
          detail="Sends a browser notification when a watched place reaches moderate flood risk or higher. Checked every 5 minutes, and only works while AquaDepth is open in a tab — there is no push server.">
          <button role="switch" aria-checked={nstate.enabled} aria-label="Warn me when risk rises" className={`wl-switch ${nstate.enabled ? 'on' : ''}`} onClick={toggleNotify} disabled={!nstate.supported}><i /></button>
        </ListRow>
      </List>
      {!nstate.supported && <p className="wl-foot">This browser does not support notifications. In-app banners will still appear here.</p>}
      {(denied || nstate.permission === 'denied') && <p className="wl-foot">Notifications are blocked for this site. Allow them in your browser settings to turn this on.</p>}

      <Sheet open={!!importing} onClose={() => setImporting(null)} title="Import places">
        {importing && (
          <div className="stack" style={{ paddingBottom: 8 }}>
            <h2 style={{ fontSize: 22, letterSpacing: '-0.03em' }}>Import {importing.length} places?</h2>
            <p style={{ color: 'var(--label-2)', fontSize: 15 }}>Added to your watchlist; places you already have are skipped.</p>
            <List>{importing.slice(0, 6).map((i) => <ListRow key={i.digipin} title={i.name} detail={i.region} />)}</List>
            <button className="btn block" style={{ background: 'var(--blue)', color: '#fff' }} onClick={confirmImport}>Import</button>
            <button className="btn block gray" onClick={() => setImporting(null)}>Cancel</button>
          </div>
        )}
      </Sheet>
      {toast && <div className="tl-toast" role="status">{toast}</div>}
    </div>
  );
}
