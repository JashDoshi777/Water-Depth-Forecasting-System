import { test, expect } from '@playwright/test';

const IGNORE = /basemaps\.cartocdn|ERR_ABORTED|Failed to load resource.*(tiles|fonts|style)/i;
function collectErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) errors.push('console: ' + m.text()); });
  return errors;
}
async function jsonOk(request, url) {
  try { const r = await request.get(url, { timeout: 45_000 }); return r.ok() && /json/.test(r.headers()['content-type'] || ''); } catch { return false; }
}
const openLayers = (page) => page.getByLabel('Layers', { exact: true }).click();
const pickPlace = async (page, q = 'Godavari') => {
  await page.getByLabel('Search water bodies').fill(q);
  await page.locator('.map-result').first().click();
};

test.describe('map UI', () => {
  test('map: layers sheet opens and closes', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/');
    await expect(page.getByTestId('map-canvas')).toBeVisible();
    await openLayers(page);
    const sheet = page.getByRole('dialog', { name: 'Map layers' });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('Water bodies');
    await expect(sheet).toContainText('Overlays');
    await expect(sheet).toContainText('Map style');
    await sheet.getByLabel('Show Lakes').click();
    await expect(sheet.getByLabel('Show Lakes')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await openLayers(page);
    await page.getByLabel('Close layers').click();
    await expect(sheet).toBeHidden();
    expect(errors).toEqual([]);
  });

  test('map: cyclone toggle shows legend and draws tracks', async ({ page, request }) => {
    const errors = collectErrors(page);
    const up = await jsonOk(request, '/api/v1/cyclones/summary');
    await page.goto('/');
    await openLayers(page);
    await page.getByRole('switch', { name: 'Cyclones' }).click();
    await page.getByLabel('Close layers').click();
    await expect(page.getByRole('group', { name: 'Cyclone tracks' })).toBeVisible();
    if (up) {
      await expect(page.getByLabel('Cyclone intensity legend')).toBeVisible();
      await page.waitForFunction(() => window.__aquaMap?.getSource('cy-tracks') && window.__aquaMap.getLayer('cy-line'), null, { timeout: 60_000 });
      await expect(page.getByLabel('From year')).toBeVisible();
    }
    expect(errors).toEqual([]);
  });

  test('map: forecast scrubber changes time label and plays', async ({ page, request }) => {
    test.skip(!(await jsonOk(request, '/api/v1/forecast-grid?var=rain&hours=48&step=3')), 'forecast-grid endpoint not live');
    const errors = collectErrors(page);
    await page.goto('/');
    await openLayers(page);
    await page.getByRole('group', { name: 'Forecast overlay' }).getByRole('button', { name: 'Rain' }).click();
    await page.getByLabel('Close layers').click();
    const label = page.getByTestId('scrub-time');
    const slider = page.getByRole('slider', { name: 'Forecast time' });
    await expect(slider).toBeEnabled({ timeout: 60_000 });
    const before = await label.textContent();
    await slider.evaluate((el) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, el.max); el.dispatchEvent(new Event('input', { bubbles: true })); });
    await expect(label).not.toHaveText(before);
    await page.waitForFunction(() => window.__aquaMap?.getLayer('fc-field'), null, { timeout: 30_000 });
    await page.getByRole('button', { name: 'Play forecast animation' }).click();
    await expect(page.getByRole('button', { name: 'Pause forecast animation' })).toBeVisible();
    await page.getByRole('button', { name: 'Pause forecast animation' }).click();
    await expect(page.getByRole('button', { name: 'Play forecast animation' })).toBeVisible();
    await page.getByRole('group', { name: 'Forecast variable' }).getByRole('button', { name: 'Waves' }).click();
    await expect(page.getByLabel('Waves legend')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('map: survey priority toggle is reachable', async ({ page }) => {
    await page.goto('/');
    await openLayers(page);
    const sw = page.getByRole('switch', { name: 'Survey priority' });
    await expect(sw).toBeVisible();
  });

  test('map: place card — watchlist star, share toast, Escape', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    await page.goto('/');
    await page.evaluate(() => localStorage.removeItem('aquadepth-watchlist'));
    await pickPlace(page);
    const panel = page.getByRole('dialog', { name: /Details for/ });
    await expect(panel).toBeVisible();
    const star = panel.getByRole('button', { name: /watchlist/ });
    await expect(star).toBeEnabled({ timeout: 60_000 });
    await star.click();
    await expect(star).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('aquadepth-watchlist') || '[]').length)).toBe(1);
    await star.click();
    await expect(star).toHaveAttribute('aria-pressed', 'false');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('aquadepth-watchlist') || '[]').length)).toBe(0);
    await panel.getByLabel('Copy share link').click();
    await expect(page.getByRole('status').filter({ hasText: /Copied|copy/ })).toBeVisible();
    await expect(panel).toContainText(/current depth/i, { timeout: 60_000 });
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
  });
});

test.describe('map mobile', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('map: mobile place sheet snaps between detents', async ({ page }) => {
    await page.goto('/');
    await pickPlace(page);
    const sheet = page.getByRole('dialog', { name: /Details for/ });
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveAttribute('data-detent', 'half');
    const grab = sheet.getByLabel(/Resize sheet/);
    const top = async () => (await sheet.boundingBox()).y;
    await expect.poll(top).toBeLessThan(450); // settled at half (≈ 52% of the map)
    const yHalf = await top();
    await grab.click();
    await expect(sheet).toHaveAttribute('data-detent', 'full');
    await expect.poll(top).toBeLessThan(yHalf - 40);
    await grab.click();
    await expect(sheet).toHaveAttribute('data-detent', 'peek');
    await expect.poll(top).toBeGreaterThan(yHalf + 40);
    await page.waitForTimeout(900); // let the spring settle before measuring the handle
    // drag up from the handle (pointer) → back to a larger detent
    const box = await grab.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) { await page.mouse.move(box.x + box.width / 2, box.y + 12 - i * 25); await page.waitForTimeout(30); }
    await page.mouse.up();
    await expect(sheet).not.toHaveAttribute('data-detent', 'peek');
    // ≥44px touch targets on the sheet actions
    for (const n of ['Add to watchlist', 'Copy share link', 'Close details']) {
      const b = await sheet.getByLabel(n).boundingBox();
      expect(b.width).toBeGreaterThanOrEqual(43.5); expect(b.height).toBeGreaterThanOrEqual(43.5);
    }
  });

  test('map: mobile layers sheet fits the viewport', async ({ page }) => {
    await page.goto('/');
    await openLayers(page);
    const b = await page.getByRole('dialog', { name: 'Map layers' }).boundingBox();
    expect(b.x).toBeGreaterThanOrEqual(0); expect(b.x + b.width).toBeLessThanOrEqual(390);
  });
});
