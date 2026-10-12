import {chromium,expect} from '@playwright/test';
const browser=await chromium.launch({channel:'chrome',headless:true});const errors=[];
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});page.on('pageerror',e=>{errors.push(e.message);console.error(e.stack)});
 let release;const gate=new Promise(resolve=>release=resolve);
 await page.route('**/aircube-base.glb',async route=>{await gate;await route.continue()});
 await page.goto(process.env.TEST_URL||'http://127.0.0.1:5177/home.html',{waitUntil:'domcontentloaded'});
 await page.locator('.room-stage').scrollIntoViewIfNeeded();await page.waitForTimeout(500);
 await expect(page.locator('.room-device-label')).toBeHidden();await expect(page.locator('.room-device-leader')).toBeHidden();await expect(page.locator('.room-poster')).toBeVisible();
 release();await page.locator('.room-stage').scrollIntoViewIfNeeded();await expect(page.locator('.room-canvas')).toHaveAttribute('data-ready','true');await expect(page.locator('.room-device-label')).toBeVisible();
 const position=()=>page.locator('.room-device-label').evaluate(e=>({x:e.offsetLeft,y:e.offsetTop}));
 const initial=await position();await page.waitForTimeout(700);expect(await position()).toEqual(initial);
 for(const width of [390,1000,1440]){await page.setViewportSize({width,height:844});await page.locator('.room-stage').scrollIntoViewIfNeeded();await page.waitForTimeout(200);
  const bounds=await page.locator('.room-stage').boundingBox(),label=await page.locator('.room-device-label').boundingBox();expect(label.x).toBeGreaterThanOrEqual(bounds.x);expect(label.x+label.width).toBeLessThanOrEqual(bounds.x+bounds.width+1);
  const canvas=await page.locator('.room-canvas canvas').evaluate(c=>({pixels:c.width,width:c.clientWidth,height:c.clientHeight}));expect(canvas.pixels).toBeGreaterThan(0);expect(canvas.width).toBeCloseTo(bounds.width,0);
 }
 await page.locator('.room-stage').screenshot({path:'captures/purpose/stable-callout-desktop.png'});
 if(errors.length)throw Error(errors.join('\n'));console.log('Passed delayed loading, fixed callout position, mobile/desktop resize, no page errors');
}finally{await browser.close()}
