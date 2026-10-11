import {chromium,expect} from '@playwright/test';
const browser=await chromium.launch({channel:'chrome',headless:true});
const errors=[];
try {
 for(const mobile of [false,true]) {
  const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1440,height:900}});
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.TEST_URL||'http://127.0.0.1:5177/home.html');
  await page.locator('.room-stage').scrollIntoViewIfNeeded();
  const canvas=page.locator('.room-canvas'),section=page.locator('#what-it-does'),play=page.locator('.room-play');
  await expect(canvas).toHaveAttribute('data-ready','true');
  const progress=async()=>Number(await canvas.getAttribute('data-progress'));
  const start=await progress();await page.waitForTimeout(400);expect(await progress()).toBeGreaterThan(start);
  await play.click();await page.waitForTimeout(800);const paused=await progress();await page.waitForTimeout(500);expect(Math.abs(await progress()-paused)).toBeLessThan(.002);
  await page.locator('[data-room-chapter="4"]').click();
  // On narrow screens the controls can scroll the canvas out of view; bring it back.
  await page.locator('.room-stage').scrollIntoViewIfNeeded();
  await expect(canvas).toHaveAttribute('data-detection','air');
  await expect(canvas).toHaveAttribute('data-detection','sensing');
  await page.locator('.room-stage').screenshot({path:`captures/purpose/${mobile?'mobile':'desktop'}-continuous-sensing.png`});
  await expect(canvas).toHaveAttribute('data-detection','signal');
  await page.locator('.room-stage').screenshot({path:`captures/purpose/${mobile?'mobile':'desktop'}-continuous-response.png`});
  await expect(section).toHaveAttribute('data-mode','paused',{timeout:10000});
  await expect(canvas).toHaveAttribute('data-detection','settling');
  await expect(play).toContainText('Replay');
  await play.click();await page.locator('.room-stage').scrollIntoViewIfNeeded();
  await expect(section).toHaveAttribute('data-mode','play');
  await expect(canvas).toHaveAttribute('data-chapter','0');
  await page.locator('.purpose-size').scrollIntoViewIfNeeded();await page.waitForTimeout(400);
  const offscreen=await progress();await page.waitForTimeout(500);expect(await progress()).toBe(offscreen);
  console.log('Passed',mobile?'mobile':'desktop','autoplay, pause, ordered detection, completion/replay, offscreen pause');
  await page.close();
 }
 if(errors.length)throw Error(errors.join('\n'));
} finally {await browser.close()}
