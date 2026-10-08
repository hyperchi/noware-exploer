import {chromium,expect} from '@playwright/test';
import fs from 'node:fs';
const browser=await chromium.launch({channel:'chrome',headless:true}),url=process.env.TEST_URL||'http://127.0.0.1:5177/home.html';
fs.mkdirSync('captures/scale',{recursive:true});
const errors=[],posters=[];
for(const mobile of [false,true]){
 const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1440,height:900}});page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);if(!await page.locator('#size').isVisible())await page.locator('.hardware-size-link').click();await page.locator('#size').scrollIntoViewIfNeeded();await expect(page.locator('.scale-canvas')).toHaveAttribute('data-ready','true');
 if(!mobile){await page.waitForTimeout(600);await page.locator('#size').screenshot({path:'captures/scale/reveal-middle.png'})}
 await expect(page.locator('.scale-canvas')).toHaveAttribute('data-reveal','1.000');
 for(const mode of ['compare','footprint']){
 await page.locator(`[data-mode=${mode}]`).click();await expect(page.locator('.scale-canvas')).toHaveAttribute('data-view',mode==='compare'?'0.000':'1.000');
 await page.locator('#size').screenshot({path:`captures/scale/${mode}${mobile?'-mobile':''}.png`});
 const data=await page.locator('.scale-canvas canvas').evaluate(c=>c.toDataURL('image/webp',.9).split(',')[1]);posters.push([`public/showcase/scale/${mode}${mobile?'-mobile':''}.webp`,Buffer.from(data,'base64')]);
 }
 for(let i=0;i<2;i++){await page.locator('[data-mode=compare]').click();await page.waitForTimeout(180);await page.locator('[data-mode=footprint]').click();await expect(page.locator('.scale-canvas')).toHaveAttribute('data-view','1.000')}
 await page.locator('[data-mode=compare]').focus();await page.keyboard.press('Enter');await expect(page.locator('.scale-canvas')).toHaveAttribute('data-view','0.000');
 await page.getByRole('button',{name:'Replay the size comparison reveal'}).click();await expect(page.locator('.scale-canvas')).toHaveAttribute('data-reveal','1.000');
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Overflow');
 console.log(mobile?'Mobile':'Desktop',await page.locator('.scale-canvas').evaluate(e=>({...e.dataset})));
 await page.close();
}
await browser.close();for(const [path,data] of posters)fs.writeFileSync(path,data);if(errors.length)throw Error(errors.join('\n'));
