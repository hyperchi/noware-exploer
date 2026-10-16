// Isolated, disposable browser fixtures. Never touches the user's live home.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createApp } from '../server.js';
import { HomeStore } from '../lib/home-store.js';
import { HomeService } from '../lib/home-service.js';
import { createSession, SESSION_COOKIE } from '../lib/session.js';
process.env.SESSION_SECRET = randomBytes(32).toString('hex');
process.env.NOWARE_DEMO = '0';
const store = new HomeStore();
const service = new HomeService({ store });
const home = store.upsertHousehold({ id: 'browser-fixture', name: 'Browser test home', members: ['browser@noso.so'], rooms: [{ id: 'office', name: 'Office', type: 'office', deviceKeys: [] }] });
const server = createApp({ homeStore: store, homeService: service }).listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const token = await createSession({ email: 'browser@noso.so', sub: 'browser' }, { secret: process.env.SESSION_SECRET, domain: 'noso.so' });
  await ctx.addCookies([{ name: SESSION_COOKIE, value: token, domain: '127.0.0.1', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }]);
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const setState = async (scenario, options = {}) => {
    service.startScenario(home, home.rooms[0], scenario, { days: 3, ...options });
    await page.goto(`${base}/dashboard/#/simple`);
    await page.reload();
    await page.getByText('The numbers, made simple', { exact: true }).waitFor();
    assert.equal(await page.locator('.simple-air').getByText('Simulated', { exact: true }).count(), 1);
  };
  await setState('healthy');
  await page.getByRole('heading', { name: 'Your air looks good.' }).waitFor();
  const firstClue = page.locator('.simple-pattern').first();
  await firstClue.getByText('How we work this out', { exact: true }).click();
  await page.waitForTimeout(2200);
  assert.equal(await firstClue.locator('details').getAttribute('open'), '', 'live refresh preserves disclosures');
  await page.getByRole('button', { name: '+ Add an activity note', exact: true }).click();
  await page.getByLabel('Activity', { exact: true }).selectOption('pet_activity');
  await page.getByLabel('A note (optional)', { exact: true }).fill('Browser test observation');
  await page.getByRole('button', { name: 'Save activity note', exact: true }).click();
  await page.getByText('Browser test observation', { exact: true }).waitFor();
  assert.equal(store.observationsFor(home.id).length, 1);
  assert.equal(store.observationsFor(home.id)[0].readingSource, 'simulated');
  await page.getByRole('button', { name: 'Remove Pet activity note', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.simple-notes'));
  assert.equal(store.observationsFor(home.id).length, 0);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `healthy overflow ${width}`);
  }
  for (const scenario of ['cooking', 'persistent_particles', 'sensor_offline', 'sensor_warming_up']) {
    await setState(scenario, scenario === 'sensor_offline' ? { withHistory: false, offsetS: 900 } : {});
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${scenario} overflow ${width}`);
    }
    if (scenario === 'sensor_offline') {
      await page.getByRole('heading', { name: 'Let’s reconnect.' }).waitFor();
      assert.equal(await page.locator('.simple-air').getByRole('button', { name: 'I did this', exact: true }).count(), 0);
      assert.ok((await page.locator('.simple-air').innerText()).includes('Last reading'));
    } else if (scenario === 'sensor_warming_up') {
      await page.getByRole('heading', { name: 'Getting to know your air.' }).waitFor();
    } else {
      const ack = page.locator('.simple-air').getByRole('button', { name: 'I did this', exact: true });
      await ack.waitFor(); await ack.click();
      await page.locator('.simple-air').getByRole('button', { name: /^Done/ }).waitFor();
      await page.getByText('Is it getting better?', { exact: true }).waitFor();
    }
    await page.screenshot({ path: `/tmp/noware-simple-${scenario}.png`, fullPage: true });
  }
  await page.getByRole('link', { name: 'Original view', exact: true }).click();
  await page.getByText('Noware dashboard', { exact: true }).waitFor();
  await page.locator('.route.active').getByRole('link', { name: 'Simple view', exact: true }).click();
  await page.getByText('The numbers, made simple', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log('Simple view passed: healthy, cooking, persistent particles, offline, warm-up; note save/remove; action/recovery; preserved original view; desktop/390px/320px; no page errors.');
} finally {
  await browser.close(); service.stopAll(); await new Promise(r => server.close(r));
}
