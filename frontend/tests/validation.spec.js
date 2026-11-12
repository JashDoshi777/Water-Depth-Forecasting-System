import { test, expect } from '@playwright/test';

function collectErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/basemaps\.cartocdn|ERR_ABORTED|Failed to load resource.*(tiles|fonts|style)/i.test(t)) return;
    errors.push('console: ' + t);
  });
  page.on('response', (r) => { if (r.status() >= 500 && r.url().includes('/api/')) errors.push(`${r.status()} ${r.url()}`); });
  return errors;
}

test.describe('validation API', () => {
  test('summary shape + honesty fields', async ({ request }) => {
    const s = await (await request.get('/api/v1/validation/summary')).json();
    for (const k of ['headline', 'histogram', 'provenance', 'caveats', 'cutoff', 'labels']) expect(s).toHaveProperty(k);
    for (const k of ['n_gauges', 'median_rmse_m', 'median_corr', 'timing_median_min', 'target_min', 'target_met', 'timing_primary_period']) expect(s.headline).toHaveProperty(k);
    expect(s.headline.n_gauges).toBeGreaterThanOrEqual(5);
    expect(s.caveats.length).toBeGreaterThan(3);
    expect(s.headline.median_corr).toBeGreaterThan(0.5);
  });

  test('stations list + valid-series length cap', async ({ request }) => {
    const { stations } = await (await request.get('/api/v1/validation/stations')).json();
    expect(stations.length).toBeGreaterThanOrEqual(5);
    for (const days of [7, 30, 90, 1000]) {
      const d = await (await request.get(`/api/v1/validation/station/${stations[0].id}?days=${days}`)).json();
      expect(d.t.length).toBeLessThanOrEqual(1500);
      expect(d.gauge_m.length).toBe(d.t.length);
      expect(d.model_m.length).toBe(d.t.length);
    }
    expect((await request.get('/api/v1/validation/station/nowhere')).status()).toBe(404);
  });

  test('tide timing + events', async ({ request }) => {
    const t = await (await request.get('/api/v1/validation/tide-timing')).json();
    expect(t.counts.out_of_sample.length).toBe(t.bin_edges_min.length - 1);
    expect(t.stations.length).toBeGreaterThan(0);
    const ev = await (await request.get('/api/v1/validation/events')).json();
    expect(ev.events.length).toBeGreaterThan(0);
    const e = await (await request.get(`/api/v1/validation/event/${encodeURIComponent(ev.featured || ev.events[0].id)}`)).json();
    expect(e.track.length).toBeGreaterThan(3);
    expect(e.t.length).toBe(e.gauge_residual.length);
    expect(e.verdict.length).toBeGreaterThan(10);
  });

  test('survey-priority GeoJSON shape + ordering + bbox', async ({ request }) => {
    const g = await (await request.get('/api/v1/ml/survey-priority?n=50')).json();
    expect(g.type).toBe('FeatureCollection');
    expect(g.features.length).toBe(50);
    let prev = Infinity;
    g.features.forEach((f, i) => {
      expect(f.geometry.type).toBe('Point');
      expect(f.properties).toHaveProperty('uncertainty_m');
      expect(f.properties).toHaveProperty('predicted_depth_m');
      expect(f.properties.rank).toBe(i + 1);
      expect(f.properties.uncertainty_m).toBeLessThanOrEqual(prev);
      prev = f.properties.uncertainty_m;
    });
    const b = await (await request.get('/api/v1/ml/survey-priority?n=20&bbox=70,5,80,15')).json();
    for (const f of b.features) { const [x, y] = f.geometry.coordinates; expect(x >= 70 && x <= 80 && y >= 5 && y <= 15).toBeTruthy(); }
  });
});

test.describe('validation + ML Lab UI', () => {
  test('Validation page renders tiles, chart, histogram, case study', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/validation');
    await expect(page.getByRole('heading', { name: 'Validation' })).toBeVisible();
    await expect(page.getByTestId('val-tiles')).toContainText('Real tide gauges');
    await expect(page.getByTestId('val-tiles')).toContainText(/Met|Not met/);
    await expect(page.getByTestId('val-disclosure')).toContainText("doesn't show");
    await expect(page.getByTestId('val-series').locator('svg.recharts-surface').first()).toBeVisible();
    await expect(page.getByTestId('val-hist').locator('.recharts-bar-rectangle').first()).toBeVisible();
    await expect(page.getByTestId('val-verdict')).toBeVisible();
    await expect(page.getByTestId('val-event').locator('svg.recharts-surface').first()).toBeVisible();
    // switch station + range
    await page.getByTestId('val-series').getByRole('tab', { name: 'Colombo' }).click();
    await page.getByTestId('val-series').getByRole('tab', { name: '7d' }).click();
    await expect(page.getByTestId('val-station-stats')).toContainText('RMSE');
    const body = await page.locator('.page.val').innerText();
    expect(body).not.toMatch(/NaN|undefined|null/);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('ML Lab shows validated card and survey section', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/ml-lab');
    await expect(page.getByTestId('ml-validated')).toContainText('Validated against real tide gauges');
    await expect(page.getByTestId('ml-validated')).toContainText(/r = 0\./);
    await expect(page.getByTestId('survey-list').locator('.list-row')).toHaveCount(10);
    const href = await page.getByTestId('survey-list').getByRole('link', { name: 'Show on map' }).first().getAttribute('href');
    expect(href).toMatch(/^\/\?lat=[-\d.]+&lon=[-\d.]+&layer=survey$/);
    await expect(page.getByTestId('ml-survey')).toContainText('not a measured error');
    expect(errors, errors.join('\n')).toEqual([]);
  });
});
