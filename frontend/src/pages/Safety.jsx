import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LifeBuoy, Info, ChevronDown, Anchor, Waves, Ship, Fish } from 'lucide-react';
import { PageHeader, Card, CardTitle, Segmented, List, ListRow } from '../components/ui';
import PlaceSearch from '../components/tools/PlaceSearch';
import Ring from '../components/tools/Ring';
import OfflineBanner from '../components/tools/OfflineBanner';
import { useWatchlist } from '../lib/watchlist';
import { searchPlaces, toItem, safetyFor, placeDetail } from '../services/api_tools';
import '../components/tools/tools.css';
import './Safety.css';

const ACTS = [{ value: 'fishing', label: 'Fishing' }, { value: 'boating', label: 'Boating' }, { value: 'swimming', label: 'Swimming' }, { value: 'shipping', label: 'Shipping' }];
const QUICK = ['Mumbai', 'Kochi', 'Chennai', 'Visakhapatnam', 'Goa', 'Puri'];
const LV = { good: { word: 'Good', color: 'var(--green)' }, caution: { word: 'Caution', color: 'var(--orange)' }, avoid: { word: 'Avoid', color: 'var(--red)' } };
const ST = { good: 'var(--green)', caution: 'var(--orange)', avoid: 'var(--red)', info: 'var(--label-3)' };
const hr = (iso) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', hour12: true });
const UNIT_LABEL = { wave_height_m: 'Wave height', wind_speed_ms: 'Wind', wind_gust_ms: 'Gusts', rain_mm_next6h: 'Rain next 6 h', visibility_km: 'Visibility', flood_ratio: 'Flood risk (× threshold)' };

export default function Safety() {
  const [params, setParams] = useSearchParams();
  const pin = params.get('digipin');
  const activity = ACTS.some((a) => a.value === params.get('activity')) ? params.get('activity') : 'boating';
  const { items: watch } = useWatchlist();
  const [place, setPlace] = useState(null);
  const [res, setRes] = useState({ loading: true });
  const [n, setN] = useState(0);
  const [quick, setQuick] = useState('');
  const [showRules, setShowRules] = useState(false);

  const setSel = (digipin, act = activity) => setParams({ digipin, activity: act }, { replace: true });

  // default place: Mumbai
  useEffect(() => {
    if (pin) return;
    searchPlaces('Mumbai', 'ocean', 1).then((d) => { const r = d.locations?.[0]; if (r) setSel(r.digipin); }).catch(() => setRes({ error: 'Couldn’t find a default place. Search for one above.' }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!pin) return undefined;
    let live = true;
    placeDetail(pin).then((l) => live && setPlace(l), () => live && setPlace(null));
    setRes({ loading: true });
    safetyFor(pin, activity).then((d) => live && setRes({ data: d }), (e) => live && setRes({ error: e?.response?.data?.detail || 'Safety data is unavailable right now.' }));
    return () => { live = false; };
  }, [pin, activity, n]);

  const pickCity = async (city) => {
    setQuick(city);
    try {
      const d = await searchPlaces(city, 'ocean', 1);
      if (d.locations?.[0]) setSel(d.locations[0].digipin);
    } catch { setRes({ error: 'Search is unavailable right now.' }); }
    setQuick('');
  };

  const d = res.data;
  const lv = d && LV[d.level];
  return (
    <div className="page">
      <PageHeader title="Safety" subtitle="Is it safe to go out? A transparent, rule-based check of waves, wind, rain and flood risk." />
      <OfflineBanner />

      <div className="sf-pick">
        <PlaceSearch placeholder="Search a place or city" onPick={(it) => setSel(it.digipin)} />
        <div className="tl-chips" aria-label="Quick picks">
          {QUICK.map((c) => <button key={c} className="tl-chip" aria-pressed={quick === c} onClick={() => pickCity(c)}>{c}</button>)}
        </div>
        {watch.length > 0 && <div className="tl-chips" aria-label="From watchlist">{watch.slice(0, 6).map((w) => <button key={w.digipin} className="tl-chip" aria-pressed={pin === w.digipin} onClick={() => setSel(w.digipin)}>{w.name}</button>)}</div>}
        <Segmented full label="Activity" options={ACTS} value={activity} onChange={(a) => (pin ? setSel(pin, a) : setParams({ activity: a }, { replace: true }))} />
      </div>

      <div className="sf-disclaimer" role="note" data-testid="safety-disclaimer">
        <Info size={20} />
        <div><b>Advisory only — not an official warning.</b> Follow IMD, INCOIS and local authority guidance. Conditions can change faster than this data updates.</div>
      </div>

      {res.error ? (
        <Card><div className="tl-err">{res.error}<button onClick={() => setN((x) => x + 1)}>Retry</button></div></Card>
      ) : res.loading || !d ? (
        <Card><div className="sf-hero"><div className="skeleton" style={{ width: 132, height: 132, borderRadius: 66 }} /><div style={{ flex: 1 }}><div className="skeleton" style={{ height: 28, width: '50%' }} /><div className="skeleton" style={{ height: 18, width: '80%', marginTop: 12 }} /></div></div></Card>
      ) : (
        <>
          <Card className="sf-hero-card" aria-label="Safety level">
            <div className="sf-hero">
              <Ring size={132} stroke={12} value={d.score / 100} color={lv.color} label={`Safety score ${d.score} out of 100, ${lv.word}`}>
                <div style={{ textAlign: 'center' }}><div className="sf-score tnum" data-testid="safety-score">{d.score}</div><div className="sf-of">of 100</div></div>
              </Ring>
              <div className="sf-txt">
                <div className="sf-level" style={{ color: lv.color }} data-testid="safety-level">{lv.word}</div>
                <div className="sf-head">{d.headline}</div>
                <div className="sf-place">{place?.name || d.digipin} · {d.activity_label}{!d.waves_modelled && <> · waves not modelled</>}</div>
              </div>
            </div>
          </Card>

          <div className="section-title">Why</div>
          <List aria-label="Reasons">
            {d.reasons.map((r) => (
              <ListRow key={r.factor} title={<span className="sf-rt"><i className="sf-dot" style={{ background: ST[r.status] }} />{r.factor}</span>} detail={r.text}
                value={r.value == null ? '—' : `${typeof r.value === 'number' ? r.value : r.value}${r.unit && r.unit !== '% probability' ? ` ${r.unit}` : r.unit ? '%' : ''}`} />
            ))}
          </List>

          <Card className="sf-out" aria-label="24 hour outlook" data-testid="safety-outlook">
            <CardTitle icon={LifeBuoy} color="var(--blue)" sub="Score every 3 hours for the next 24 hours (taller is safer)">24-hour outlook</CardTitle>
            <div className="sf-bars">
              {d.outlook.map((o) => (
                <div key={o.time} className="sf-bar" title={`${hr(o.time)}: ${o.score} (${o.level})`}>
                  <div className="sf-track"><i style={{ height: `${Math.max(o.score, 6)}%`, background: LV[o.level].color }} /></div>
                  <span className="tnum">{hr(o.time)}</span>
                </div>
              ))}
            </div>
          </Card>

          <button className="sf-rules-btn" onClick={() => setShowRules((v) => !v)} aria-expanded={showRules}>How this is scored <ChevronDown size={15} style={{ transform: showRules ? 'rotate(180deg)' : 'none', transition: 'transform .25s' }} /></button>
          {showRules && (
            <Card flush className="table-wrap">
              <table className="table"><thead><tr><th>Factor ({d.activity_label})</th><th>Caution at</th><th>Avoid at</th></tr></thead>
                <tbody>{Object.entries(d.thresholds).map(([k, t]) => (
                  <tr key={k} style={{ cursor: 'default' }}><td>{UNIT_LABEL[k] || k}</td><td className="tnum">{t.direction === 'below' ? '≤' : '≥'} {t.caution} {k === 'flood_ratio' ? '×' : t.unit}</td><td className="tnum">{t.direction === 'below' ? '≤' : '≥'} {t.avoid} {k === 'flood_ratio' ? '×' : t.unit}</td></tr>
                ))}</tbody></table>
              <p className="sf-note">Score = 100 − worst factor penalty − 30% of the others. “Avoid” if any factor reaches its avoid level or the score is below 40; “Caution” if any reaches caution or the score is below 70. Flood risk uses the ML model’s probability as a multiple of its warning threshold. Waves apply to coastal points only.</p>
            </Card>
          )}
          <p className="sf-note" style={{ marginTop: 14 }}>Sources: {d.sources.join(' · ')}. Updated {new Date(d.generated_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}.</p>
        </>
      )}
    </div>
  );
}
