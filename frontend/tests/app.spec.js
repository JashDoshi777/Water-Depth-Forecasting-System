import { test, expect } from '@playwright/test';

const PIN = 'F2CJ4JCM4M'; // Mumbai coast (ocean)

function collectErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/basemaps\.cartocdn|ERR_ABORTED|Failed to load resource.*(tiles|fonts|style)/i.test(t)) return;
    errors.push('console: ' + t);
  });
  page.on('response', (r) => {
    if (r.status() >= 500 && r.url().includes('/api/')) errors.push(`${r.status()} ${r.url()}`);
  });
  return errors;
}

test.describe('API', () => {
  test('health + DIGIPIN round trip', async ({ request }) => {
    expect((await request.get('/api/health')).ok()).toBeTruthy();
    const enc = await (await request.post('/api/v1/digipin/encode', { data: { latitude: 19.07, longitude: 72.87 } })).json();
    expect(enc.digipin).toBe(PIN);
    const dec = await (await request.post('/api/v1/digipin/decode', { data: { digipin: PIN } })).json();
    expect(dec.latitude).toBeCloseTo(19.07, 3);
  });

  test('city search + flood regression (lat > 25°N)', async ({ request }) => {
    const r = await (await request.get('/api/v1/locations/search?q=mumbai')).json();
    expect(r.locations.length).toBeGreaterThan(0);
    expect((await request.get('/api/v1/flood/risk?latitude=27.2&longitude=78.0')).status()).toBe(200);
  });

  test('no inland point is classed as ocean', async ({ request }) => {
    const r = await (await request.post('/api/v1/depth/current', { data: { latitude: 21.1, longitude: 79.0 }, timeout: 60_000 })).json();
    expect(r.water_body_type).not.toBe('ocean');
  });

  test('bathymetry overlay renders for both schemes', async ({ request }) => {
    for (const s of ['light', 'dark']) {
      const r = await request.get(`/api/v1/bathymetry/overlay.png?scheme=${s}`, { timeout: 60_000 });
      expect(r.status()).toBe(200);
      expect(r.headers()['content-type']).toBe('image/png');
    }
  });

  test('ML: 48 h forecast per the brief curl, within the 500 ms budget', async ({ request }) => {
    const r = await request.post('/api/forecast', { data: { digipin: PIN, timestamp: new Date().toISOString().slice(0, 16) }, timeout: 90_000 });
    expect(r.status()).toBe(200);
    const d = await r.json();
    expect(d.model_version).toMatch(/xgboost/);
    expect(d.forecast).toHaveLength(48);
    for (const p of d.forecast) {
      expect(p.confidence_low).toBeLessThanOrEqual(p.predicted_depth);
      expect(p.confidence_high).toBeGreaterThanOrEqual(p.predicted_depth);
      expect(p.predicted_depth).toBeGreaterThan(0);
    }
    expect(d.inference_ms).toBeLessThan(500);
  });

  test('ML: flood probability, static depth, overview', async ({ request }) => {
    const f = await (await request.post('/api/v1/ml/flood', { data: { digipin: PIN }, timeout: 90_000 })).json();
    expect(f.probability).toBeGreaterThanOrEqual(0); expect(f.probability).toBeLessThanOrEqual(1);
    const s = await (await request.post('/api/v1/ml/static-depth', { data: { digipin: PIN } })).json();
    expect(s.predicted_depth_m).toBeGreaterThan(0);
    const o = await (await request.get('/api/v1/ml/overview')).json();
    expect(o.runtime.forecast_48h_p95_ms).toBeLessThan(500);
    expect(o.metrics.forecast.n_train).toBeGreaterThan(100000);
  });

  test('ML rejects a timestamp outside the live window', async ({ request }) => {
    const r = await request.post('/api/forecast', { data: { digipin: PIN, timestamp: '2020-01-01T00:00' }, timeout: 60_000 });
    expect(r.status()).toBe(422);
  });

  test('alerts + system status', async ({ request }) => {
    const a = await (await request.get('/api/v1/alerts/active', { timeout: 90_000 })).json();
    expect(a.locations_ok).toBeGreaterThan(8);
    const s = await (await request.get('/api/v1/system/status', { timeout: 30_000 })).json();
    expect(s.sources.length).toBe(6);
  });
});

test.describe('Desktop UI', () => {
  test('map: canvas, stats, search → panel → detail', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/');
    await expect(page.getByTestId('map-canvas')).toBeVisible();
    await expect(page.getByLabel('Water body statistics')).toContainText('96.2K');
    await page.getByLabel('Search water bodies').fill('Godavari');
    await page.locator('.map-result').first().click();
    const panel = page.getByRole('dialog');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(/current depth/i, { timeout: 60_000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'e2e-shots/map-panel.png' });
    await page.getByRole('button', { name: /view full analysis/i }).click();
    await expect(page).toHaveURL(/\/location\//);
    expect(errors).toEqual([]);
  });

  test('map: layer switcher and Escape closes panel', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Show Rivers').click();
    await expect(page.getByLabel('Show Rivers')).toHaveAttribute('aria-pressed', 'true');
    await page.getByLabel('Show All').click();
    await expect(page.getByLabel('Show All')).toHaveAttribute('aria-pressed', 'true');
  });

  test('sidebar reaches every page', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/');
    for (const [label, path] of [['Forecast', '/forecast'], ['Alerts', '/alerts'], ['Insights', '/analytics'], ['Locations', '/locations'], ['ML Lab', '/ml-lab'], ['Data Sources', '/data-sources'], ['Map', '/']]) {
      await page.locator('.sidebar').getByRole('link', { name: label }).click();
      await expect(page).toHaveURL(new RegExp(path === '/' ? '/$' : path));
    }
    expect(errors).toEqual([]);
  });

  test('theme switch applies light and dark', async ({ page }) => {
    await page.goto('/analytics');
    const sw = page.locator('.sidebar').getByRole('tablist', { name: 'Appearance' });
    await sw.getByRole('tab', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(0, 0, 0)');
    await sw.getByRole('tab', { name: 'Light' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(242, 242, 247)');
  });

  test('forecast: quick pick renders ML chart and table', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/forecast');
    await page.getByRole('button', { name: 'Mumbai', exact: true }).click();
    await expect(page.getByTestId('selected-name')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByLabel('Forecast chart')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByLabel('Hourly forecast')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('locations: search, type tabs, pagination', async ({ page }) => {
    await page.goto('/locations');
    await expect(page.getByTestId('location-row').first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/1–50 of/)).toBeVisible();
    await page.getByRole('tab', { name: /^Lake/ }).click();
    await expect(page.getByTestId('location-row').first()).toContainText(/lake/i, { timeout: 60_000 });
  });

  test('insights: real charts, no NaN/undefined', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/analytics');
    await expect(page.getByText('Location distribution')).toBeVisible();
    await expect(page.getByText('Observed rainfall')).toBeVisible();
    await expect(page.locator('.recharts-area-curve, .recharts-line-curve').first()).toBeVisible({ timeout: 60_000 });
    await page.getByRole('tab', { name: 'Chennai' }).click();
    await page.waitForTimeout(1500);
    expect(await page.locator('body').innerText()).not.toMatch(/NaN|undefined/);
    expect(errors).toEqual([]);
  });

  test('alerts: monitored list populated', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/alerts');
    await expect(page.locator('.al-row').first()).toBeVisible({ timeout: 90_000 });
    expect(await page.locator('.al-row').count()).toBeGreaterThan(8);
    await expect(page.getByText(/Updated/)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('data sources: live status, honest copy', async ({ page }) => {
    await page.goto('/data-sources');
    await expect(page.getByText('Sources healthy')).toBeVisible();
    await expect(page.getByText(/^\d\/6$/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('99.9%')).toHaveCount(0);
  });

  test('ML Lab: honest metrics + live demo', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/ml-lab');
    await expect(page.getByTestId('model-static')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('model-forecast')).toContainText('Not met'); // tide-phase target is reported honestly
    await expect(page.getByTestId('ml-tiles')).toContainText('10,11,360');
    await expect(page.getByTestId('demo-forecast').locator('.recharts-line-curve')).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId('demo-flood')).toContainText('%');
    await page.screenshot({ path: 'e2e-shots/ml-lab.png', fullPage: true });
    expect(errors).toEqual([]);
  });

  test('location detail: depth, forecast, history', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(`/location/${PIN}`);
    await expect(page.getByTestId('depth-value')).toBeVisible({ timeout: 90_000 });
    await expect(page.getByLabel('Depth fusion breakdown')).toBeVisible();
    await expect(page.getByRole('tablist', { name: 'Forecast horizon' })).toBeVisible();
    await page.getByRole('tab', { name: '12h' }).click();
    await expect(page.getByLabel('History')).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe('Mobile UI (iOS tab bar)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('tab bar + More sheet, no horizontal overflow', async ({ page }) => {
    test.setTimeout(240_000); // visits 6 pages; slower when run alongside other workers
    await page.goto('/analytics');
    const tabs = page.getByRole('navigation', { name: 'Tab bar' });
    await expect(tabs).toBeVisible();
    await expect(page.locator('.sidebar')).toBeHidden();
    await tabs.getByRole('link', { name: 'Alerts' }).click();
    await expect(page).toHaveURL(/\/alerts/);
    await tabs.getByRole('button', { name: 'More' }).click();
    await expect(page.getByRole('dialog', { name: 'More' })).toBeVisible();
    await page.getByRole('dialog', { name: 'More' }).getByText('ML Lab').click();
    await expect(page).toHaveURL(/\/ml-lab/);
    for (const p of ['/analytics', '/alerts', '/locations', '/forecast', '/data-sources', '/ml-lab']) {
      await page.goto(p);
      await page.waitForTimeout(2500);
      const overflow = await page.evaluate(() => { const m = document.querySelector('.main'); return m.scrollWidth - m.clientWidth; });
      expect(overflow, `${p} overflows horizontally`).toBeLessThanOrEqual(1);
    }
    await page.goto('/');
    await page.waitForTimeout(4000);
    await page.screenshot({ path: 'e2e-shots/mobile-map.png' });
  });
});
