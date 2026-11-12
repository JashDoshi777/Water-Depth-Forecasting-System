import { test, expect } from '@playwright/test';

const PIN = 'F2CJ4JCM4M'; // Mumbai coast (ocean)
const RIVER = 'F646PKKTC4'; // Krishna floodplain (river)
const ITEM = { digipin: PIN, name: 'Mumbai test', lat: 19.07, lon: 72.87, type: 'ocean', region: 'Maharashtra' };

function collectErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/basemaps\.cartocdn|ERR_ABORTED|Failed to load resource.*(tiles|fonts|style)/i.test(t)) return;
    errors.push('console: ' + t);
  });
  return errors;
}

const seed = (items, extra = {}) => async (page) => {
  await page.addInitScript(([i, e]) => {
    if (!sessionStorage.getItem('seeded')) { localStorage.setItem('aquadepth-watchlist', JSON.stringify(i)); Object.entries(e).forEach(([k, v]) => localStorage.setItem(k, v)); sessionStorage.setItem('seeded', '1'); }
  }, [items, extra]);
};
const mockNotification = (page, perm = 'default') => page.addInitScript((p) => {
  window.__notes = [];
  class N { constructor(t, o) { window.__notes.push({ t, o }); } static get permission() { return window.__perm; } static async requestPermission() { window.__perm = 'granted'; sessionStorage.setItem('perm', 'granted'); return 'granted'; } }
  window.__perm = sessionStorage.getItem('perm') || p; window.Notification = N;
}, perm);

test.describe('Watchlist', () => {
  test('add, persist, remove', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/watchlist');
    await expect(page.getByText('No places yet')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Find places' })).toHaveAttribute('href', '/');
    await page.getByLabel('Add a place — search by name or city').fill('Mumbai');
    await page.getByRole('option').first().click();
    await expect(page.getByTestId('watch-card')).toHaveCount(1);
    await expect(page.getByTestId('watch-depth')).toBeVisible({ timeout: 60_000 });
    await page.reload();
    await expect(page.getByTestId('watch-card')).toHaveCount(1);
    await page.getByRole('button', { name: /^Remove .* from watchlist$/ }).click();
    await expect(page.getByTestId('watch-card')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('share link import + CSV export', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await seed([ITEM])(page);
    await page.goto('/watchlist');
    await expect(page.getByTestId('watch-card')).toHaveCount(1);
    await page.getByRole('button', { name: 'Share' }).click();
    await expect(page.getByText('Link copied')).toBeVisible();
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(link).toContain('/watchlist?share=');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
    expect(dl.suggestedFilename()).toMatch(/^aquadepth-watchlist-.*\.csv$/);
    // import on a clean slate
    await page.evaluate(() => localStorage.setItem('aquadepth-watchlist', '[]'));
    await page.goto(link);
    await expect(page.getByRole('heading', { name: 'Import 1 places?' })).toBeVisible();
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.getByTestId('watch-card')).toHaveCount(1);
  });

  test('notification toggle + risk-rise banner', async ({ page }) => {
    await mockNotification(page);
    await seed([ITEM], { 'aquadepth-risk-last': JSON.stringify({ [PIN]: 'low' }) })(page);
    await page.route('**/api/v1/ml/flood', (r) => r.fulfill({ json: { digipin: PIN, probability: 0.7, level: 'high', rain_72h_mm: 10, threshold: 0.3 } }));
    await page.goto('/watchlist');
    const sw = page.getByRole('switch', { name: 'Warn me when risk rises' });
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByText(/only works while AquaDepth is open/)).toBeVisible();
    await expect(page.getByTestId('risk-banner')).toBeVisible(); // in-app banner works without permission
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    expect(await page.evaluate(() => localStorage.getItem('aquadepth-notify'))).toBe('1');
    // now arm a fresh rise and re-check: notification fires
    await page.evaluate(() => localStorage.setItem('aquadepth-risk-last', JSON.stringify({ F2CJ4JCM4M: 'low' })));
    await page.reload();
    await expect.poll(() => page.evaluate(() => window.__notes.length)).toBeGreaterThan(0);
  });
});

test('compare two places renders chart and keeps URL ids', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto(`/compare?ids=${PIN},${RIVER}`);
  await expect(page.getByTestId('compare-col')).toHaveCount(2);
  await expect(page.getByTestId('compare-chart')).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('.recharts-line').first()).toBeVisible();
  await page.getByRole('tab', { name: 'Absolute' }).click();
  expect(page.url()).toContain(`ids=${PIN},${RIVER}`);
  await page.getByRole('button', { name: /^Remove .* from comparison$/ }).first().click();
  await expect(page.getByTestId('compare-col')).toHaveCount(1);
  expect(page.url()).toContain(`ids=${RIVER}`);
  expect(errors).toEqual([]);
});

test.describe('Safety', () => {
  test('API shape', async ({ request }) => {
    const r = await request.get(`/api/v1/safety?digipin=${PIN}&activity=boating`);
    expect(r.ok()).toBeTruthy();
    const j = await r.json();
    expect(j.score).toBeGreaterThanOrEqual(0); expect(j.score).toBeLessThanOrEqual(100);
    expect(['good', 'caution', 'avoid']).toContain(j.level);
    expect(j.reasons.length).toBeGreaterThan(2);
    for (const k of ['factor', 'value', 'unit', 'status', 'text']) expect(j.reasons[0]).toHaveProperty(k);
    for (const k of ['wave_height_m', 'wind_speed_ms', 'wind_gust_ms', 'rain_mm_next6h', 'tide_phase', 'flood_probability']) expect(j.factors).toHaveProperty(k);
    expect(j.outlook).toHaveLength(8);
    expect(j.thresholds.wave_height_m.avoid).toBeGreaterThan(j.thresholds.wave_height_m.caution);
    expect(j.disclaimer).toMatch(/not an official warning/i);
    expect((await request.get('/api/v1/safety?digipin=F646PKKTC4&activity=nope')).status()).toBe(422);
  });

  for (const [label, pin] of [['coastal', PIN], ['inland', RIVER]]) {
    test(`UI ${label}`, async ({ page }) => {
      const errors = collectErrors(page);
      await page.goto(`/safety?digipin=${pin}&activity=swimming`);
      await expect(page.getByTestId('safety-level')).toBeVisible({ timeout: 90_000 });
      await expect(page.getByTestId('safety-outlook')).toBeVisible();
      await expect(page.getByTestId('safety-disclaimer')).toContainText('Advisory only — not an official warning');
      await expect(page.getByLabel('Reasons')).toBeVisible();
      if (pin === RIVER) await expect(page.getByText('Waves are not modelled for inland waters.')).toBeVisible();
      expect(errors).toEqual([]);
    });
  }
});

test('developers: try it returns JSON', async ({ page }) => {
  await page.goto('/developers');
  await expect(page.getByTestId('base-url')).toBeVisible();
  await page.getByRole('button', { name: 'Send request' }).click();
  await expect(page.getByTestId('try-result')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId('try-latency')).toContainText('ms');
  await expect(page.getByTestId('try-result').locator('code')).toContainText('{');
  await page.getByRole('tab', { name: 'Python' }).click();
  await expect(page.locator('.dv-code code').first()).toContainText('requests.post');
});

test('command palette', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/developers');
  await expect(page.getByRole('heading', { name: 'Developers' })).toBeVisible();
  await page.waitForTimeout(700);
  await page.keyboard.press('Control+k');
  const dlg = page.getByRole('dialog', { name: 'Command palette' });
  await expect(dlg).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox').fill('safety');
  await expect(page.getByRole('option', { name: /Safety/ }).first()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/safety/);
  await expect(dlg).toBeHidden();
  await page.keyboard.press('/');
  await expect(dlg).toBeVisible();
  await page.getByRole('combobox').fill('dark');
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(errors).toEqual([]);
});

test('PWA manifest and service worker are served', async ({ request }) => {
  const m = await request.get('/manifest.webmanifest');
  expect(m.ok()).toBeTruthy();
  const j = await m.json();
  expect(j.display).toBe('standalone');
  expect(j.icons.map((i) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
  expect((await request.get('/sw.js')).ok()).toBeTruthy();
  expect((await request.get('/icon-192.png')).ok()).toBeTruthy();
});

test('location detail header actions', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(`/location/${PIN}`);
  await page.getByRole('button', { name: 'Add to watchlist' }).click();
  await expect(page.getByRole('button', { name: 'Remove from watchlist' })).toBeVisible();
  await page.getByRole('button', { name: 'Share link' }).click();
  await expect(page.getByText('Copied', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export report' })).toBeVisible();
});
