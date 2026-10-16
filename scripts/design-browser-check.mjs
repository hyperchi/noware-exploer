import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1050}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.TEST_URL||'http://localhost:5175');await page.locator('#design-kind').waitFor();
 await page.locator('#design-variant').selectOption('pro');await page.locator('#design-kind').selectOption('cellular');
 assert.match(await page.locator('#design-results').innerText(),/Supply current below modeled peak/);
 assert.deepEqual(await page.locator('[data-design-ref]').evaluateAll(es=>es.map(e=>e.dataset.designRef)),['U7','U6','P1']);
 assert.match(await page.locator('#design-board-note').innerText(),/proposed additions/);
 await page.locator('#design-usbCurrent').fill('1500');await page.locator('#design-usbCurrent').blur();
 await page.locator('#design-supply').fill('1500');await page.locator('#design-supply').blur();
 assert.match(await page.locator('#design-results').innerText(),/Connection possible/);
 await page.locator('[data-flag=sim]').uncheck();await page.locator('#run-design').click();await page.getByText('SIM unavailable',{exact:true}).waitFor();
 assert.ok(!await page.locator('#design-events').getByText('Send reading',{exact:true}).count());
 await page.locator('[data-flag=sim]').check();await page.locator('#run-design').click();await page.getByText('Server acknowledgement',{exact:true}).waitFor();
 await page.locator('#save-baseline').click();await page.locator('#design-kind').selectOption('wifi');assert.match(await page.locator('.lab-baseline').innerText(),/Add cellular/);
 assert.deepEqual(await page.locator('[data-design-ref]').evaluateAll(es=>es.map(e=>e.dataset.designRef)),['U7','U6']);
 assert.equal(await page.locator('[data-design-ref=U7]').getAttribute('data-design-action'),'Replace with Wi-Fi MCU');
 await page.locator('#plus').click();assert.equal(await page.locator('[data-design-ref]').count(),2);
 await page.locator('#back').click();assert.equal(await page.locator('[data-design-ref]').count(),0);
 await page.locator('#design-kind').selectOption('thread');assert.equal(await page.locator('#front').getAttribute('class'),'active');assert.equal(await page.locator('[data-design-ref]').count(),1);
 await page.locator('#design-kind').selectOption('wifi');
 await page.locator('#inspect-original').click();assert.match(await page.locator('#inspector').innerText(),/ESP32-H2/);
 const downloadPromise=page.waitForEvent('download');await page.locator('#export-design').click();const download=await downloadPromise;assert.equal(download.suggestedFilename(),'noware-design-study.json');
 await page.reload();assert.equal(await page.locator('#design-kind').inputValue(),'wifi');assert.equal(await page.locator('#design-variant').inputValue(),'pro');
 await page.screenshot({path:'/tmp/noware-design-desktop.png',fullPage:true});
 for(const width of [390,320]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth), `Overflow at ${width}: ${JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll("body *")].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,8).map(e=>({id:e.id,cls:e.className,right:e.getBoundingClientRect().right}))))}`);}
 await page.screenshot({path:'/tmp/noware-design-mobile.png',fullPage:true});
 await page.getByRole('tab',{name:'Air & LEDs'}).click();assert.equal(await page.locator('[data-design-ref]').count(),0);await page.locator('#model').selectOption('pro');assert.ok(await page.locator('#co2').isEnabled());
 assert.deepEqual(errors,[]);console.log('Design lab: Pro selection, cellular power/SIM faults, successful sequence, baseline, export, persistence, board inspection, mobile and environment tab passed.');
}finally{await browser.close()}
