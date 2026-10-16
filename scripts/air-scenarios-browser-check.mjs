import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { createSession, SESSION_COOKIE } from '../lib/session.js';
import { SCENARIOS } from '../lib/air-intelligence/index.js';
const base = process.env.TEST_URL || 'http://localhost:8091';
const token = await createSession({ email: 'matrix@noso.so', sub: 'matrix' }, { secret: process.env.SESSION_SECRET, domain: 'noso.so' });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const ctx = await browser.newContext();
  await ctx.addCookies([{ name: SESSION_COOKIE, value: token, domain: new URL(base).hostname, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }]);
  const p = await ctx.newPage(), errors = [];
  p.on('pageerror', e => errors.push(e.message));
  for (const width of [1440, 390]) {
    await p.setViewportSize({ width, height: 900 });
    for (const key of Object.keys(SCENARIOS)) {
      await p.goto(`${base}/dashboard/#/scenario/${key}`);
      await p.getByText('Your air right now', { exact: true }).waitFor();
      await p.getByText('Sensor details', { exact: true }).waitFor();
      await p.waitForFunction(() => document.body.innerText.includes('SIMULATED') || document.body.innerText.includes('Simulated'));
      if (key === 'sensor_offline') await p.getByText('Sensor offline', { exact: true }).first().waitFor();
      if (key === 'sensor_warming_up') await p.getByText('AirCube is warming up', { exact: true }).waitFor();
      if (key === 'legacy_base') assert.equal(await p.getByText('PM2.5', { exact: true }).count(), 0);
      assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${key} overflow at ${width}`);
      if (['healthy', 'persistent_particles', 'sensor_offline', 'sensor_warming_up'].includes(key)) await p.screenshot({ path: `/tmp/air-${key}-${width}.png`, fullPage: true });
    }
  }
  assert.deepEqual(errors, []);
  console.log(`Passed ${Object.keys(SCENARIOS).length} scenarios at desktop and mobile sizes, including explicit offline and warm-up assertions.`);
} finally { await browser.close(); }
