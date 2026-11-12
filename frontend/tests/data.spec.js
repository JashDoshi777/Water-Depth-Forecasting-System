import { test, expect } from '@playwright/test';

const API = 'http://localhost:7860/api/v1';

test.describe('Data backend API', () => {
  test('waterbodies geojson: real named bodies with contract props', async ({ request }) => {
    const r = await request.get(`${API}/waterbodies/geojson`);
    expect(r.ok()).toBeTruthy();
    const j = await r.json();
    expect(j.features.length).toBeGreaterThan(500);
    for (const f of j.features.slice(0, 50)) {
      for (const k of ['id', 'name', 'kind', 'state', 'area_km2', 'mean_depth_m', 'lat', 'lon', 'digipin', 'has_outline'])
        expect(f.properties).toHaveProperty(k);
      expect(['lake', 'reservoir']).toContain(f.properties.kind);
    }
    const lakes = await (await request.get(`${API}/waterbodies/geojson?kind=lake`)).json();
    expect(lakes.features.every((f) => f.properties.kind === 'lake')).toBeTruthy();
  });

  test('waterbodies list / detail / stats', async ({ request }) => {
    const l = await (await request.get(`${API}/waterbodies/list?q=tehri&limit=5`)).json();
    expect(l.total).toBeGreaterThan(0);
    const one = await request.get(`${API}/waterbodies/${l.items[0].id}`);
    expect((await one.json()).name).toContain('Tehri');
    expect((await request.get(`${API}/waterbodies/nope-xx`)).status()).toBe(404);
    const s = await (await request.get(`${API}/waterbodies/stats`)).json();
    expect(s.total).toBeGreaterThan(500);
    expect(s.by_kind.reservoir).toBeGreaterThan(0);
  });

  test('locations grid uses real water bodies', async ({ request }) => {
    const s = await (await request.get(`${API}/locations/search?q=Hirakud&limit=3`)).json();
    expect(s.total).toBeGreaterThan(0);
    expect(s.locations[0].water_body_type).toBe('reservoir');
    expect(s.locations[0].region).toBe('Odisha');
  });

  test('cyclones tracks / storm / summary', async ({ request }) => {
    const t = await (await request.get(`${API}/cyclones/tracks?year_from=2015&min_category=VSCS`)).json();
    expect(t.features.length).toBeGreaterThan(3);
    expect(t.features[0].geometry.type).toBe('LineString');
    for (const k of ['sid', 'name', 'year', 'season', 'max_wind_kt', 'min_pressure_hpa', 'category', 'start', 'end'])
      expect(t.features[0].properties).toHaveProperty(k);
    expect((await request.get(`${API}/cyclones/tracks?min_category=XX`)).status()).toBe(400);
    const st = await (await request.get(`${API}/cyclones/storm/2020136N10088`)).json();
    expect(st.name).toBe('Amphan');
    expect(st.points.length).toBeGreaterThan(10);
    expect(st.points[0]).toHaveProperty('wind_kt');
    expect((await request.get(`${API}/cyclones/storm/none`)).status()).toBe(404);
    const sm = await (await request.get(`${API}/cyclones/summary`)).json();
    expect(sm.strongest.length).toBe(10);
    expect(Object.keys(sm.count_by_year).length).toBeGreaterThan(50);
  });

  test('forecast-grid frames shape (or clean upstream error)', async ({ request }) => {
    test.setTimeout(90000);
    const r = await request.get(`${API}/forecast-grid?var=rain&hours=24&step=6`, { timeout: 80000 });
    if (r.status() === 503) {
      expect((await r.json()).error).toBe('upstream_unavailable');
      return;
    }
    const j = await r.json();
    expect(j.nx * j.ny).toBe(j.lats.length * j.lons.length);
    expect(j.frames.length).toBe(j.times.length);
    expect(j.frames[0].length).toBe(j.nx * j.ny);
    expect(j.bounds).toHaveProperty('lat_min');
  });
});
