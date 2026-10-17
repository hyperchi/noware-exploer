// Manual live-device check. Requires the local development server and a real
// physical publisher; does not seed or fabricate any readings.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const base = process.env.TEST_URL || 'http://localhost:8091';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${base}/dev-login`);
  await page.waitForURL(/#\/device\//);
  await page.getByText('SEN63C PM2.5', { exact: true }).waitFor();
  const verify = await page.evaluate(async () => {
    const cube = await fetch('/api/cube').then(r => r.json());
    const me = await fetch('/api/home/me').then(r => r.json());
    const home = await fetch(`/api/home/households/${me.households[0].id}/summary`).then(r => r.json());
    return { cube, me, home };
  });
  assert.equal(verify.cube.meta.source, 'physical');
  assert.equal(verify.cube.online, true);
  assert.ok(verify.cube.slots.length > 0, 'actual recorded history is available');
  assert.ok(verify.me.households.every(h => !h.demo));
  assert.ok(verify.home.rooms.every(r => r.source === 'physical'));
  assert.equal(await page.getByText('Try a scenario', { exact: true }).count(), 0);
  await page.getByRole('tab', { name: 'PM2.5', exact: true }).click();
  await page.screenshot({ path: '/tmp/noware-live-classic-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: '/tmp/noware-live-classic-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Back to all devices', exact: true }).click();
  await page.getByText('Noware dashboard', { exact: true }).waitFor();
  assert.equal(await page.locator('.device-card').count(), 1);
  await page.getByRole('link', { name: 'Air insights', exact: true }).click();
  await page.locator('.route.active').getByText('Rooms', { exact: true }).first().waitFor();
  assert.equal(await page.getByText('Try a scenario', { exact: true }).count(), 0);
  await page.locator('.route.active').getByRole('link', { name: 'Simple view', exact: true }).click();
  await page.getByText('The numbers, made simple', { exact: true }).waitFor();
  await page.getByText('Outdoor conditions unknown', { exact: true }).waitFor();
  assert.equal(await page.locator('.simple-air').getByText('Simulated', { exact: true }).count(), 0);
  await page.evaluate(() => window.scrollTo(0, 900));
  await page.waitForTimeout(4500);
  assert.ok(await page.evaluate(() => scrollY >= 850), 'live sensor updates must preserve reading position');
  await page.screenshot({ path: '/tmp/noware-simple-live-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.screenshot({ path: '/tmp/noware-simple-live-desktop.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Classic dashboard passed: physical readings/history, PM2.5 chart, original device cards/detail, secondary insights/simple view, stable scroll during live updates, no demo home or scenario controls, desktop/mobile.');
} finally { await browser.close(); }
