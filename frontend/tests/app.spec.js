import { test, expect } from '@playwright/test';

const PIN = 'F2CJ4JCM4M'; // Mumbai coast

function collectErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // map tile/style CDN hiccups aren't app bugs
    if (/basemaps\.cartocdn|Failed to load resource.*(tiles|fonts)/i.test(t)) return;
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

  test('city search returns nearby water bodies', async ({ request }) => {
    const r = await (await request.get('/api/v1/locations/search?q=mumbai')).json();
    expect(r.locations.length).toBeGreaterThan(0);
    expect(r.locations[0].distance_km).toBeLessThan(150);
  });

  test('flood risk works north of 25°N (regression: NameError on lon)', async ({ request }) => {
    const r = await request.get('/api/v1/flood/risk?latitude=27.2&longitude=78.0');
    expect(r.status()).toBe(200);
  });

  test('alerts scan covers locations', async ({ request }) => {
    const r = await (await request.get('/api/v1/alerts/active', { timeout: 60_000 })).json();
    expect(r.locations_ok).toBeGreaterThan(8);
  });

  test('system status reports real sources', async ({ request }) => {
    const r = await (await request.get('/api/v1/system/status', { timeout: 30_000 })).json();
    expect(r.sources.length).toBe(6);
  });
});

test.describe('Desktop UI', () => {
  test('dashboard: map, stats, search → panel → detail page', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/');
    await expect(page.locator('.maplibregl-canvas')).toBeVisible();
    await expect(page.getByText('95.9K')).toBeVisible();
    await page.getByPlaceholder(/Search DIGIPIN/i).fill('Godavari');
    await page.locator('.location-card').first().click();
    await expect(page.getByText('Current Water Depth')).toBeVisible({ timeout: 40_000 });
    await expect(page.locator('.maplibregl-ctrl-bottom-right')).toBeVisible();
    await page.screenshot({ path: 'e2e-shots/dashboard-panel.png' });
    await page.getByRole('button', { name: /View Full Analysis/ }).click();
    await expect(page).toHaveURL(/\/location\//);
    expect(errors).toEqual([]);
  });

  test('dashboard filter pills toggle', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Rivers', { exact: true }).first().click();
    await expect(page.locator('.map-filter-pill.active')).toContainText('Rivers');
  });

  test('sidebar navigation reaches every page', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/');
    for (const [label, path] of [['Forecast', '/forecast'], ['Locations', '/locations'], ['Analytics', '/analytics'], ['Alerts', '/alerts'], ['Data Sources', '/data-sources'], ['Dashboard', '/']]) {
      await page.locator('.sidebar').getByRole('link', { name: label }).click();
      await expect(page).toHaveURL(new RegExp(path === '/' ? '/$' : path));
    }
    expect(errors).toEqual([]);
  });

  test('forecast: quick pick Mumbai renders chart', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/forecast');
    await page.getByRole('button', { name: 'Mumbai' }).click();
    await expect(page.locator('.recharts-area-curve').first()).toBeVisible({ timeout: 45_000 });
    await page.screenshot({ path: 'e2e-shots/forecast-mumbai.png' });
    expect(errors).toEqual([]);
  });

  test('locations: full DIGIPIN, type filter, search', async ({ page }) => {
    await page.goto('/locations');
    const firstPin = page.locator('.data-table tbody tr').first().locator('td').nth(3);
    await expect(firstPin).toHaveText(/^[A-Z0-9]{10}$/);
    await page.getByRole('button', { name: 'Lake', exact: true }).click();
    await expect(page.locator('.data-table tbody tr').first().locator('.chip')).toHaveText('lake');
  });

  test('analytics: real charts, no NaN', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/analytics');
    await expect(page.getByText('Daily Rainfall — Last 90 Days')).toBeVisible();
    await expect(page.locator('.recharts-area-curve')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.recharts-bar-rectangle').first()).toBeVisible();
    expect(await page.locator('body').innerText()).not.toMatch(/NaN|undefined/);
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'e2e-shots/analytics-full.png', fullPage: true });
    expect(errors).toEqual([]);
  });

  test('alerts: monitored list populated', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/alerts');
    await expect(page.locator('.alert-card').first()).toBeVisible({ timeout: 60_000 });
    expect(await page.locator('.alert-card').count()).toBeGreaterThan(8);
    expect(errors).toEqual([]);
  });

  test('data sources: live status, no hardcoded uptime', async ({ page }) => {
    await page.goto('/data-sources');
    await expect(page.getByText('Sources Healthy')).toBeVisible();
    await expect(page.getByText(/^\d\/6$/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('99.9%')).toHaveCount(0);
  });

  test('location detail shows depth, tide and both charts', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(`/location/${PIN}`);
    await expect(page.getByText('Current Water Depth')).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText('72-Hour History')).toBeVisible();
    await expect(page.locator('.recharts-line-curve').first()).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe('Mobile UI', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('drawer navigation works and pages fit the screen', async ({ page }) => {
    await page.goto('/analytics');
    await page.locator('.mobile-menu-btn').click();
    await expect(page.locator('.sidebar.open')).toBeVisible();
    await page.locator('.sidebar').getByRole('link', { name: 'Alerts' }).click();
    await expect(page).toHaveURL(/\/alerts/);
    await expect(page.locator('.sidebar.open')).toHaveCount(0);
    for (const p of ['/', '/analytics', '/alerts', '/locations', '/forecast', '/data-sources']) {
      await page.goto(p);
      await page.waitForTimeout(2500);
      const overflow = await page.evaluate(() => document.querySelector('.main-content').scrollWidth - document.querySelector('.main-content').clientWidth);
      expect(overflow, `${p} overflows horizontally`).toBeLessThanOrEqual(1);
    }
    await page.goto('/');
    await page.waitForTimeout(4000);
    await page.screenshot({ path: 'e2e-shots/mobile-dashboard.png' });
  });
});
