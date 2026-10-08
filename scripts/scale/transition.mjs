import {chromium,expect} from '@playwright/test';
import fs from 'node:fs';
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto(process.env.TEST_URL||'http://127.0.0.1:5177/home.html');await page.locator('.hardware-size-link').click();await expect(page.locator('.scale-canvas')).toHaveAttribute('data-reveal','1.000');
const report=[];
for(const mode of ['footprint','compare','footprint']){
 const result=await page.evaluate(async mode=>{
  const host=document.querySelector('.scale-canvas'),label=document.querySelector('[data-scale-anchor=width]'),samples=[],frames=[];let next=0;const checkpoints=[.8,.95,.999,1],end=mode==='footprint'?1:0;
  document.querySelector(`[data-mode=${mode}]`).click();const start=performance.now();
  while(performance.now()-start<2500){await new Promise(requestAnimationFrame);const view=Number(host.dataset.view),progress=end===1?view:1-view;samples.push({progress,x:parseFloat(label.style.left),y:parseFloat(label.style.top)});while(next<checkpoints.length&&progress>=checkpoints[next]){frames.push(host.querySelector('canvas').toDataURL('image/png').split(',')[1]);next++}if(progress===1)break}
  return {samples,frames};
 },mode);
 const tail=result.samples.filter(s=>s.progress>=.98),moves=tail.slice(1).map((s,i)=>Math.hypot(s.x-tail[i].x,s.y-tail[i].y));
 const rates=tail.slice(1).map((s,i)=>moves[i]/Math.max(.001,s.progress-tail[i].progress));
 // Normalize for elapsed animation progress: capturing frames can skip display frames.
 if(Math.max(...rates)>800)throw Error(`Late camera discontinuity in ${mode}: ${Math.max(...rates)} pixels per progress unit`);
 await expect(page.locator('.scale-canvas')).toHaveAttribute('data-view',mode==='footprint'?'1.000':'0.000');
 result.frames.forEach((data,i)=>fs.writeFileSync(`captures/scale/transition-${mode}-${i}.png`,Buffer.from(data,'base64')));report.push({mode,maximumLateFrameMovement:Math.max(...moves),maximumMovementPerProgress:Math.max(...rates)});
}
await browser.close();if(errors.length)throw Error(errors.join('\n'));console.log(report);fs.writeFileSync('captures/scale/transition-check.json',JSON.stringify(report,null,2));
