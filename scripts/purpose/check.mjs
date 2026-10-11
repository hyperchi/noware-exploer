import {chromium,expect} from '@playwright/test';
import fs from 'node:fs';
const browser=await chromium.launch({channel:'chrome',headless:true}),errors=[],posters=[];
const url=process.env.TEST_URL||'http://127.0.0.1:5177/home.html';
fs.mkdirSync('captures/purpose',{recursive:true});
for(const mobile of [false,true]){
 const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1440,height:900},deviceScaleFactor:1,reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);await page.waitForSelector('.hardware-ready');
 expect(await page.locator('#app > section').evaluateAll(elements=>elements.map(e=>e.id).slice(0,4))).toEqual(['hardware','what-it-does','size-intro','size']);
 const purpose=page.locator('#what-it-does');await purpose.scrollIntoViewIfNeeded();await expect(page.locator('.room-canvas')).toHaveAttribute('data-ready','true');
 posters.push([`public/showcase/room/poster${mobile?'-mobile':''}.webp`,await page.locator('.room-canvas canvas').evaluate(c=>c.toDataURL('image/webp',.92).split(',')[1])]);
 await purpose.screenshot({path:`captures/purpose/${mobile?'mobile':'desktop'}-room.png`});
 for(const chapter of [1,2,3,4,0]){await page.locator(`[data-room-chapter="${chapter}"]`).click();await expect(page.locator('.room-canvas')).toHaveAttribute('data-chapter',String(chapter));await page.locator('.room-sticky').screenshot({path:`captures/purpose/${mobile?'mobile':'desktop'}-scene-${chapter}.png`})}
 await page.locator('[data-room-chapter="4"]').focus();await page.keyboard.press('Enter');await expect(purpose).toHaveAttribute('data-chapter','4');
 await page.locator('.purpose-size-open').click();await expect(page.locator('#size')).toBeVisible();await expect(page.locator('.scale-canvas')).toHaveAttribute('data-ready','true');await page.locator('[data-mode=footprint]').click();await expect(page.locator('.scale-canvas')).toHaveAttribute('data-view','1.000');await page.locator('#size').screenshot({path:`captures/purpose/${mobile?'mobile':'desktop'}-size-final.png`});await page.keyboard.press('Escape');await expect(page.locator('.purpose-size-open')).toBeFocused();
 await page.locator('.hardware-size-link').click();await expect(page.locator('#size')).toBeVisible();await page.keyboard.press('Escape');await expect(page.locator('.hardware-size-link')).toBeFocused();
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Horizontal overflow');console.log('Passed',mobile?'mobile':'desktop','room chapters, keyboard, no overflow, both size disclosures');await page.close();
}
const page=await browser.newPage({viewport:{width:1440,height:900}});page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await page.locator('#what-it-does').scrollIntoViewIfNeeded();await expect(page.locator('.room-canvas')).toHaveAttribute('data-ready','true');
for(const [progress,chapter] of [[.08,0],[.28,1],[.48,2],[.68,3],[.88,4],[.48,2],[.08,0]]){await page.evaluate(progress=>{const s=document.querySelector('.room-scroll'),sticky=document.querySelector('.room-sticky');scrollTo(0,s.getBoundingClientRect().top+scrollY+(s.offsetHeight-sticky.offsetHeight)*progress-16)},progress);await expect(page.locator('.room-canvas')).toHaveAttribute('data-chapter',String(chapter));await page.waitForTimeout(220)}
await page.locator('[data-room-chapter="1"]').click();await page.waitForTimeout(350);await page.locator('.room-stage').screenshot({path:'captures/purpose/pet-motion-early.png'});await page.waitForTimeout(400);await page.locator('.room-stage').screenshot({path:'captures/purpose/pet-motion-late.png'});
console.log('Passed forward and reverse scroll through the same room.');await page.close();await browser.close();
for(const [path,data] of posters)fs.writeFileSync(path,Buffer.from(data,'base64'));if(errors.length)throw Error(errors.join('\n'));
