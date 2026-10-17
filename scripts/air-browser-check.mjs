/* Browser check for the air-intelligence dashboard against a running server.
 *
 *   SESSION_SECRET=... TEST_URL=http://localhost:8089 node scripts/air-browser-check.mjs
 *
 * Signs in with a locally minted session cookie (needs the server's
 * SESSION_SECRET), walks home -> room -> contractor -> settings, checks the
 * five homeowner questions are answered on screen, that simulated data is
 * labelled, that mobile does not overflow, and that no page errors occur.
 * Screenshots land in the directory given by SHOT_DIR (default /tmp).
 */
import { chromium } from '@playwright/test';
import { createSession, SESSION_COOKIE } from '../lib/session.js';

const base = process.env.TEST_URL || 'http://localhost:8089';
const shots = process.env.SHOT_DIR || '/tmp';
const email = process.env.TEST_EMAIL || 'winston@noso.so';
if (!process.env.SESSION_SECRET) throw new Error('SESSION_SECRET is required to mint a session');
const token = await createSession({ email, sub: 'browser-check', name: 'Winston' }, { secret: process.env.SESSION_SECRET, domain: 'noso.so' });
const url = new URL(base);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addCookies([{ name: SESSION_COOKIE, value: token, domain: url.hostname, path: '/', httpOnly: true, secure: true, sameSite: 'Lax' }]);
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const expectText = async (text, where) => {
  try {
    await page.waitForFunction((t) => document.body.innerText.toLowerCase().includes(t.toLowerCase()), text, { timeout: 15000 });
  } catch {
    throw new Error(`Expected "${text}" on ${where}`);
  }
};

async function main() {
// Home
await page.goto(`${base}/dashboard/#/intelligence`);
await expectText('Rooms', 'home');
await expectText('Kitchen', 'home');
await expectText('Simulated', 'home');
await expectText('Demo Comfort Co.', 'home');
await page.screenshot({ path: `${shots}/air-home.png`, fullPage: true });

// Room: kitchen (mid cooking event in the demo seed)
await page.getByText('Kitchen', { exact: true }).first().click();
await expectText('Your air right now', 'room');
await expectText('What should I do?', 'room');
await expectText('PM2.5', 'room');
await expectText('Normally in this room', 'room');
await expectText('Likely', 'room');
await expectText('confidence', 'room');
await expectText('Sensor details', 'room');
await expectText('Did it work?', 'room');
await expectText('Your home comfort provider', 'room');
await page.screenshot({ path: `${shots}/air-room.png`, fullPage: true });

// Acknowledge the first DIY action and see the recovery wording change.
const did = page.getByRole('button', { name: 'I did this' }).first();
await did.click();
await expectText('since you', 'room after ack');

// Evidence drawer and feedback
await page.getByText('See the evidence').first().click();
await expectText('measured', 'evidence');
// Feedback is one-shot per event: a rerun against the same server sees the thanks.
if (await page.getByRole('button', { name: "That's right" }).count()) await page.getByRole('button', { name: "That's right" }).first().click();
await expectText('Thanks', 'feedback');

// Developer view
await page.getByRole('button', { name: /Developer view/ }).first().click();
await expectText('Features & baselines', 'developer view');
await page.screenshot({ path: `${shots}/air-room-dev.png`, fullPage: true });

// Contact flow preview
await page.getByRole('button', { name: 'Request service' }).first().click();
await expectText('attached automatically', 'contact modal');
await expectText('Actions tried', 'contact payload');
await page.getByRole('button', { name: 'Send with air summary' }).click();
await expectText('Request recorded', 'contact result');
await page.keyboard.press('Escape');

// Contractor
await page.goto(`${base}/dashboard/#/contractor`);
await expectText('Needs attention', 'contractor list');
await expectText('Smith Home', 'contractor list');
await page.screenshot({ path: `${shots}/air-contractor.png`, fullPage: true });
await page.getByText("Smith Home").first().click();
await expectText('Recurring issues', 'customer detail');
await expectText('Observed issue', 'customer detail');
await expectText('Possible solutions', 'customer detail');
await expectText('Requires on-site diagnosis', 'customer detail');
await page.screenshot({ path: `${shots}/air-customer.png`, fullPage: true });

// Settings: household context
await page.goto(`${base}/dashboard/#/settings`);
await expectText('What matters in this home', 'settings');
await expectText('Share air insights', 'settings');
await page.screenshot({ path: `${shots}/air-settings.png`, fullPage: true });

// Scenario in-tab (no server needed) and mobile layout
await page.goto(`${base}/dashboard/#/scenario/sensor_offline`);
await expectText('Simulated', 'scenario');
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${base}/dashboard/#/room/demo-home-winston/kitchen`);
await expectText('Your air right now', 'mobile room');
await page.waitForTimeout(1500);
if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw new Error('Mobile overflow on room page');
await page.screenshot({ path: `${shots}/air-room-mobile.png`, fullPage: true });
await page.goto(`${base}/dashboard/#/intelligence`);
await expectText('Rooms', 'mobile home');
if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw new Error('Mobile overflow on home');
await page.screenshot({ path: `${shots}/air-home-mobile.png`, fullPage: true });

const real = errors.filter((e) => !/favicon|ERR_CONNECTION/.test(e));
if (real.length) throw new Error(`Page errors:\n${real.join('\n')}`);
console.log('Air browser checks passed: home, room (hero, actions, numbers, baseline, confidence, recovery, evidence, feedback, developer view, contact payload), contractor list and detail, settings, scenario, mobile layout.');
}

try {
  await main();
} catch (err) {
  await page.screenshot({ path: `${shots}/air-failure.png`, fullPage: true }).catch(() => {});
  console.error(err.message);
  if (errors.length) console.error('Page errors so far:\n' + errors.join('\n'));
  console.error('URL at failure:', page.url());
  process.exitCode = 1;
} finally {
  await browser.close();
}
