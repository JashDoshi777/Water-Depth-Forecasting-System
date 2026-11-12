import React, { useMemo, useState } from 'react';
import { Copy, Check, ExternalLink, Play, Server, Gauge } from 'lucide-react';
import { PageHeader, Card, CardTitle, Segmented, List, ListRow } from '../components/ui';
import '../components/tools/tools.css';
import './Developers.css';

const PIN = 'F2CJ4JCM4M';
const EPS = [
  { value: 'forecast', label: 'Forecast', method: 'POST', path: '/api/forecast', body: { digipin: PIN, timestamp: hourNow() }, note: 'Depth forecast for a DIGIPIN at a timestamp.' },
  { value: 'flood', label: 'Flood', method: 'POST', path: '/api/v1/ml/flood', body: { digipin: PIN }, note: 'ML flood-warning probability with uncertainty.' },
  { value: 'depth', label: 'Depth', method: 'POST', path: '/api/v1/depth/current', body: { digipin: PIN }, note: 'Current fused depth (base + tide + rain + discharge).' },
  { value: 'safety', label: 'Safety', method: 'GET', path: '/api/v1/safety?digipin=' + PIN + '&activity=boating', note: 'Rule-based safety score. activity = fishing | boating | swimming | shipping.' },
  { value: 'alerts', label: 'Alerts', method: 'GET', path: '/api/v1/alerts/active', note: 'Currently active flood alerts across monitored places.' },
];
const LANGS = [{ value: 'curl', label: 'curl' }, { value: 'js', label: 'JavaScript' }, { value: 'py', label: 'Python' }];

function snippet(lang, ep, base) {
  const url = base + ep.path, body = ep.body && JSON.stringify(ep.body);
  if (lang === 'curl') return ep.method === 'GET' ? `curl "${url}"` : `curl -X POST ${url} \\\n  -H "Content-Type: application/json" \\\n  -d '${body}'`;
  if (lang === 'js') return ep.method === 'GET'
    ? `const res = await fetch("${url}");\nconst data = await res.json();\nconsole.log(data);`
    : `const res = await fetch("${url}", {\n  method: "POST",\n  headers: { "Content-Type": "application/json" },\n  body: JSON.stringify(${JSON.stringify(ep.body, null, 2).replace(/\n/g, '\n  ')}),\n});\nconst data = await res.json();\nconsole.log(data);`;
  return ep.method === 'GET'
    ? `import requests\n\nr = requests.get("${url}")\nprint(r.json())`
    : `import requests\n\nr = requests.post(\n    "${url}",\n    json=${JSON.stringify(ep.body).replace(/"/g, '"')},\n)\nprint(r.json())`;
}

function Code({ text, label }) {
  const [ok, setOk] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1400); } catch { /* ignore */ } };
  return (
    <div className="dv-code">
      <button className="dv-copy" onClick={copy} aria-label={`Copy ${label}`}>{ok ? <Check size={14} /> : <Copy size={14} />}{ok ? 'Copied' : 'Copy'}</button>
      <pre tabIndex={0}><code>{text}</code></pre>
    </div>
  );
}

function hourNow() { const d = new Date(); d.setMinutes(0, 0, 0); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 19); }

export default function Developers() {
  const base = typeof window !== 'undefined' ? window.location.origin : '';
  const [ep, setEp] = useState('forecast');
  const [lang, setLang] = useState('curl');
  const e = EPS.find((x) => x.value === ep);
  const code = useMemo(() => snippet(lang, e, base), [lang, e, base]);

  const [pin, setPin] = useState(PIN);
  const [ts, setTs] = useState(hourNow);
  const [run, setRun] = useState(null);
  const go = async () => {
    setRun({ loading: true });
    const t0 = performance.now();
    try {
      const r = await fetch('/api/forecast', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ digipin: pin.trim(), timestamp: ts }) });
      const txt = await r.text();
      let json; try { json = JSON.parse(txt); } catch { json = txt; }
      setRun({ status: r.status, ok: r.ok, ms: Math.round(performance.now() - t0), json });
    } catch (err) { setRun({ error: String(err.message || err), ms: Math.round(performance.now() - t0) }); }
  };

  return (
    <div className="page">
      <PageHeader title="Developers" subtitle="A free, open JSON API. There are no API keys or accounts — just call it." />

      <div className="grid c2 dv-top">
        <List>
          <ListRow icon={Server} iconColor="var(--blue)" title="Base URL" detail="All endpoints are relative to this origin"><code className="mono dv-inline" data-testid="base-url">{base}</code></ListRow>
          <ListRow icon={ExternalLink} iconColor="var(--green)" title="Interactive docs" detail="Live OpenAPI (Swagger UI)" onClick={() => window.open('/api/docs', '_blank', 'noopener')} value="/api/docs" />
        </List>
        <List aria-label="Usage notes">
          <ListRow icon={Gauge} iconColor="var(--orange)" title="Fair use" detail="No enforced rate limit and no key. Data comes from free upstream sources (Open-Meteo, ERA5, GloFAS), so responses are cached for minutes to an hour and heavy polling won’t give fresher data. Please keep to a few requests per second." />
        </List>
      </div>

      <div className="section-title">Endpoints</div>
      <Card>
        <div className="stack">
          <div style={{ overflowX: 'auto' }}><Segmented full label="Endpoint" options={EPS.map((x) => ({ value: x.value, label: x.label }))} value={ep} onChange={setEp} /></div>
          <div className="row wrap" style={{ gap: 8 }}><span className={`dv-method ${e.method}`}>{e.method}</span><code className="mono dv-path">{e.path}</code></div>
          <p className="dv-note">{e.note}</p>
          <Segmented label="Language" options={LANGS} value={lang} onChange={setLang} />
          <Code text={code} label="code snippet" />
        </div>
      </Card>

      <div className="section-title">Try it</div>
      <Card aria-label="Try it">
        <CardTitle icon={Play} color="var(--green)" sub="Calls POST /api/forecast from your browser. The timestamp must be within about 14 days back to 1 day ahead.">Live forecast request</CardTitle>
        <div className="dv-form">
          <label>DIGIPIN<input value={pin} onChange={(x) => setPin(x.target.value)} aria-label="DIGIPIN" className="mono" /></label>
          <label>Timestamp<input value={ts} onChange={(x) => setTs(x.target.value)} aria-label="Timestamp" className="mono" /></label>
          <button className="btn" style={{ background: 'var(--blue)', color: '#fff' }} onClick={go} disabled={run?.loading}><Play size={14} />{run?.loading ? 'Sending…' : 'Send request'}</button>
        </div>
        {run && !run.loading && (
          <div style={{ marginTop: 16 }} data-testid="try-result">
            <div className="row wrap" style={{ marginBottom: 8, gap: 8 }}>
              {run.error ? <span className="badge red">Network error</span> : <span className={`badge ${run.ok ? 'green' : 'red'}`}>{run.status}</span>}
              <span className="badge blue tnum" data-testid="try-latency">{run.ms} ms</span>
            </div>
            <div className="dv-code"><pre tabIndex={0} style={{ maxHeight: 360 }}><code>{run.error || (typeof run.json === 'string' ? run.json : JSON.stringify(run.json, null, 2))}</code></pre></div>
          </div>
        )}
        {run?.loading && <div className="skeleton" style={{ height: 120, marginTop: 16 }} />}
      </Card>
    </div>
  );
}
