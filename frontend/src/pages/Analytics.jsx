import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area, Cell as BarCell,
} from 'recharts';
import { MapPin, Waves, Gauge, AlertTriangle, Ruler, Layers, CloudRain, CloudOff } from 'lucide-react';
import { PageHeader, Card, CardTitle, Stat, Segmented, ChartTip, fadeUp } from '../components/ui';
import { fmtNum, TYPE_COLOR } from '../lib/format';
import { getAnalyticsOverview, getDepthDistribution, getSeasonalAnalysis, getHistoricalRainfall } from '../services/api';
import './Analytics.css';

const CITIES = [
  { value: 'mumbai', label: 'Mumbai', lat: 19.076, lon: 72.878 },
  { value: 'chennai', label: 'Chennai', lat: 13.083, lon: 80.27 },
  { value: 'kolkata', label: 'Kolkata', lat: 22.572, lon: 88.364 },
  { value: 'kochi', label: 'Kochi', lat: 9.931, lon: 76.267 },
  { value: 'guwahati', label: 'Guwahati', lat: 26.144, lon: 91.736 },
];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TYPES = [
  { key: 'ocean', label: 'Coastal', field: 'coastal_locations' },
  { key: 'river', label: 'Rivers', field: 'river_locations' },
  { key: 'lake', label: 'Lakes', field: 'lake_locations' },
  { key: 'reservoir', label: 'Reservoirs', field: 'reservoir_locations' },
];
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const shortDate = (s) => {
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

function ChartEmpty({ children = 'No data available', icon: Icon = CloudOff }) {
  return <div className="an-empty"><Icon size={26} /><span>{children}</span></div>;
}
const Sk = ({ h = 220 }) => <div className="skeleton" style={{ height: h, borderRadius: 12 }} />;

export default function Analytics() {
  const [overview, setOverview] = useState({ state: 'loading' });
  const [dist, setDist] = useState({ state: 'loading' });
  const [city, setCity] = useState('mumbai');
  const [climate, setClimate] = useState({ state: 'loading' });

  useEffect(() => {
    let live = true;
    getAnalyticsOverview().then((d) => live && setOverview({ state: 'ok', d })).catch(() => live && setOverview({ state: 'error' }));
    getDepthDistribution().then((d) => live && setDist({ state: 'ok', d })).catch(() => live && setDist({ state: 'error' }));
    return () => { live = false; };
  }, []);

  useEffect(() => {
    let live = true;
    const c = CITIES.find((x) => x.value === city);
    setClimate({ state: 'loading' });
    Promise.allSettled([getSeasonalAnalysis(c.lat, c.lon), getHistoricalRainfall(c.lat, c.lon, 90)]).then(([s, r]) => {
      if (!live) return;
      setClimate({ state: 'ok', seasonal: s.status === 'fulfilled' ? s.value : null, rain: r.status === 'fulfilled' ? r.value : null });
    });
    return () => { live = false; };
  }, [city]);

  const ov = overview.d;
  const donut = useMemo(() => (ov ? TYPES.map((t) => ({ name: t.label, key: t.key, value: num(ov[t.field]) ?? 0 })).filter((x) => x.value > 0) : []), [ov]);
  const donutTotal = donut.reduce((a, d) => a + d.value, 0);

  const bars = useMemo(() => {
    const m = dist.d?.distribution;
    if (!m) return [];
    return TYPES.filter((t) => m[t.key]).map((t) => ({
      key: t.key, name: t.label, avg: num(m[t.key].avg_depth), max: num(m[t.key].max_depth), count: m[t.key].count,
    })).filter((b) => b.avg != null);
  }, [dist.d]);

  const monsoon = useMemo(() => {
    const m = climate.seasonal?.monthly_monsoon_index;
    if (!m) return [];
    return MONTHS.map((name, i) => ({ name, idx: num(m[String(i + 1)]) ?? 0, month: i + 1 }));
  }, [climate.seasonal]);
  const curMonth = climate.seasonal?.current_month;

  const rain = useMemo(() => {
    const a = climate.rain?.daily_precipitation;
    return Array.isArray(a) ? a.filter((r) => num(r.precipitation_mm) != null).map((r) => ({ date: r.date, mm: r.precipitation_mm })) : [];
  }, [climate.rain]);
  const cityLabel = CITIES.find((c) => c.value === city).label;
  const wet = rain.length ? rain.reduce((a, r) => a + (r.mm >= 2.5 ? 1 : 0), 0) : null;
  const peakDay = rain.length ? rain.reduce((a, r) => (r.mm > a.mm ? r : a), rain[0]) : null;

  const ld = overview.state === 'loading';
  const stagger = (i) => ({ ...fadeUp, transition: { ...fadeUp.transition, delay: Math.min(i, 8) * 0.04 } });

  return (
    <div className="page an">
      <PageHeader title="Insights" subtitle="Network-wide statistics and regional climate context for every monitored water body." />

      {overview.state === 'error' && <Card className="an-banner" role="alert"><AlertTriangle size={16} style={{ color: 'var(--orange)' }} /> Network overview is unavailable right now.</Card>}

      <div className="grid c4 an-stats" data-testid="overview-stats">
        <motion.div {...stagger(0)}><Stat loading={ld} label="Locations" icon={MapPin} color="var(--blue)" value={fmtNum(ov?.total_locations)} foot={ov ? `${fmtNum(ov.coastal_locations)} coastal · ${fmtNum(ov.inland_locations)} inland` : '—'} /></motion.div>
        <motion.div {...stagger(1)}><Stat loading={ld} label="Rivers, lakes, reservoirs" icon={Waves} color="var(--teal)" value={fmtNum((ov?.river_locations ?? 0) + (ov?.lake_locations ?? 0) + (ov?.reservoir_locations ?? 0))} foot={ov ? `${fmtNum(ov.river_locations)} rivers · ${fmtNum(ov.lake_locations)} lakes · ${fmtNum(ov.reservoir_locations)} reservoirs` : '—'} /></motion.div>
        <motion.div {...stagger(2)}><Stat loading={ld} label="Average depth" icon={Gauge} color="var(--indigo)" value={fmtNum(ov?.avg_depth_m, 1)} unit="m" foot={ov ? `Max ${fmtNum(ov.max_depth_m, 0)} m · min ${fmtNum(ov.min_depth_m, 1)} m` : '—'} /></motion.div>
        <motion.div {...stagger(3)}><Stat loading={ld} label="Active alerts" icon={AlertTriangle} color={ov?.active_alerts ? 'var(--red)' : 'var(--green)'} value={fmtNum(ov?.active_alerts)} foot={ov ? (ov.active_alerts ? 'Needs attention' : 'All clear') : '—'} /></motion.div>
      </div>

      <div className="grid c2 an-row">
        <motion.div {...stagger(4)}>
          <Card style={{ height: '100%' }}>
            <CardTitle icon={Layers} color="var(--blue)" sub="Share of monitored locations by water-body type">Location distribution</CardTitle>
            {ld ? <Sk /> : !donut.length ? <ChartEmpty>No location data</ChartEmpty> : (
              <div className="an-donut">
                <div className="an-donut-chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={donut} dataKey="value" nameKey="name" innerRadius="66%" outerRadius="100%" paddingAngle={2} cornerRadius={5} stroke="none" startAngle={90} endAngle={-270}>
                        {donut.map((d) => <Cell key={d.key} fill={TYPE_COLOR[d.key]} />)}
                      </Pie>
                      <Tooltip content={<ChartTip digits={0} />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="an-donut-center"><b className="tnum">{fmtNum(donutTotal)}</b><span>locations</span></div>
                </div>
                <ul className="an-legend">
                  {donut.map((d) => (
                    <li key={d.key}>
                      <i style={{ background: TYPE_COLOR[d.key] }} />
                      <span className="an-legend-name">{d.name}</span>
                      <span className="tnum an-legend-val">{fmtNum(d.value)}</span>
                      <span className="tnum an-legend-pct">{((d.value / donutTotal) * 100).toFixed(d.value / donutTotal < 0.01 ? 2 : 1)}%</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        </motion.div>

        <motion.div {...stagger(5)}>
          <Card style={{ height: '100%' }}>
            <CardTitle icon={Ruler} color="var(--indigo)" sub={`Average and maximum modelled depth, log scale${dist.d?.sample_size ? ` · sample of ${fmtNum(dist.d.sample_size)}` : ''}`}>Depth by water-body type</CardTitle>
            {dist.state === 'loading' ? <Sk /> : dist.state === 'error' || !bars.length ? <ChartEmpty>Depth distribution unavailable</ChartEmpty> : (
              <>
                <div style={{ height: 230 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={bars} margin={{ top: 8, right: 4, left: -8, bottom: 0 }} barGap={4}>
                      <CartesianGrid vertical={false} />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} />
                      <YAxis scale="log" domain={[1, 'auto']} allowDataOverflow axisLine={false} tickLine={false} width={44} tickFormatter={(v) => `${v}`} ticks={[1, 10, 100, 1000]} />
                      <Tooltip cursor={{ fill: 'var(--fill-3)' }} content={<ChartTip unit=" m" digits={1} />} />
                      <Bar dataKey="avg" name="Average" fill="var(--blue)" radius={[6, 6, 0, 0]} maxBarSize={28} />
                      <Bar dataKey="max" name="Maximum" fill="var(--indigo)" fillOpacity={0.45} radius={[6, 6, 0, 0]} maxBarSize={28} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="an-legend-inline"><span><i style={{ background: 'var(--blue)' }} />Average (m)</span><span><i style={{ background: 'var(--indigo)', opacity: 0.45 }} />Maximum (m)</span></div>
              </>
            )}
          </Card>
        </motion.div>
      </div>

      <div className="an-climate-head">
        <div>
          <h2 className="section-title" style={{ margin: 0 }}>Regional climate</h2>
          <p className="an-climate-sub">Real model data for the selected city.</p>
        </div>
        <Segmented label="City" options={CITIES.map(({ value, label }) => ({ value, label }))} value={city} onChange={setCity} />
      </div>

      <div className="grid c2 an-row">
        <motion.div {...stagger(6)}>
          <Card style={{ height: '100%' }}>
            <CardTitle icon={CloudRain} color="var(--teal)" sub={`Monsoon intensity index by month, ${cityLabel}${climate.seasonal?.current_season ? ` · now ${climate.seasonal.current_season}` : ''}`}>Monsoon seasonality</CardTitle>
            {climate.state === 'loading' ? <Sk h={230} /> : !monsoon.length ? <ChartEmpty>Seasonal data unavailable</ChartEmpty> : (
              <>
                <div style={{ height: 230 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={monsoon} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
                      <CartesianGrid vertical={false} />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} interval={0} tick={{ fontSize: 10 }} />
                      <YAxis domain={[0, 1]} axisLine={false} tickLine={false} ticks={[0, 0.5, 1]} />
                      <Tooltip cursor={{ fill: 'var(--fill-3)' }} content={<ChartTip digits={2} />} />
                      <Bar dataKey="idx" name="Intensity" radius={[6, 6, 0, 0]} maxBarSize={22}>
                        {monsoon.map((m) => <BarCell key={m.month} fill={m.month === curMonth ? 'var(--blue)' : 'var(--teal)'} fillOpacity={m.month === curMonth ? 1 : 0.55} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="an-legend-inline">
                  <span><i style={{ background: 'var(--blue)' }} />Current month</span>
                  {climate.seasonal?.peak_monsoon_month && <span>Peak: {MONTHS[climate.seasonal.peak_monsoon_month - 1]}</span>}
                </div>
              </>
            )}
          </Card>
        </motion.div>

        <motion.div {...stagger(7)}>
          <Card style={{ height: '100%' }}>
            <CardTitle icon={CloudRain} color="var(--blue)" sub={`Daily precipitation, last 90 days, ${cityLabel}`}>Observed rainfall</CardTitle>
            {climate.state === 'loading' ? <Sk h={230} /> : !rain.length ? <ChartEmpty>Rainfall history unavailable</ChartEmpty> : (
              <>
                <div style={{ height: 230 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={rain} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
                      <CartesianGrid vertical={false} />
                      <XAxis dataKey="date" axisLine={false} tickLine={false} minTickGap={36} tickFormatter={shortDate} />
                      <YAxis axisLine={false} tickLine={false} tickFormatter={(v) => `${v}`} />
                      <Tooltip cursor={{ stroke: 'var(--label-3)' }} content={<ChartTip unit=" mm" digits={1} labelFormatter={shortDate} />} />
                      <Area type="monotone" dataKey="mm" name="Rainfall" stroke="var(--blue)" strokeWidth={2} strokeLinecap="round" fill="var(--blue)" fillOpacity={0.15} dot={false} activeDot={{ r: 4, strokeWidth: 0, fill: 'var(--blue)' }} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <div className="an-legend-inline">
                  <span>Total {fmtNum(climate.rain?.total_mm ?? rain.reduce((a, r) => a + r.mm, 0), 0)} mm</span>
                  <span>{wet} wet days</span>
                  {peakDay && <span>Peak {fmtNum(peakDay.mm, 1)} mm on {shortDate(peakDay.date)}</span>}
                </div>
              </>
            )}
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
