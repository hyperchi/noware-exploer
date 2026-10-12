import {chromium,expect} from '@playwright/test';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 for(const [width,height] of [[1440,900],[1440,700],[1024,768],[390,844],[430,932]]){
  const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'});
  await page.goto(process.env.TEST_URL||'http://127.0.0.1:5177/home.html');await page.locator('.hardware-visual').scrollIntoViewIfNeeded();await expect(page.locator('.hardware-canvas')).toHaveAttribute('data-explode','0.00');
  const measure=()=>page.locator('.hardware-visual').evaluate(async stage=>{
   const image=stage.querySelector('.hardware-poster');await image.decode();const live=stage.querySelector('canvas'),w=stage.clientWidth,h=stage.clientHeight;
   function bounds(source){const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d');const sw=source.naturalWidth||source.width,sh=source.naturalHeight||source.height,scale=Math.min(w/sw,h/sh);ctx.drawImage(source,(w-sw*scale)/2,(h-sh*scale)/2,sw*scale,sh*scale);const d=ctx.getImageData(0,0,w,h).data;const rows=new Array(h).fill(0),cols=new Array(w).fill(0);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;if(d[i+3]>200&&d[i+1]>d[i]+8&&d[i+1]>d[i+2]+8){rows[y]++;cols[x]++}}const thresholdX=Math.max(...cols)*.1,thresholdY=Math.max(...rows)*.1;const xs=cols.map((n,i)=>n>thresholdX?i:-1).filter(i=>i>=0),ys=rows.map((n,i)=>n>thresholdY?i:-1).filter(i=>i>=0);const left=xs[0],right=xs.at(-1),top=ys[0],bottom=ys.at(-1);return [left,right,top,bottom]}
   return {poster:bounds(image),live:bounds(live),size:[w,h]};
  });
  const first=await measure();for(let i=0;i<4;i++)expect(Math.abs(first.poster[i]-first.live[i])).toBeLessThanOrEqual(3);
  await page.reload();await page.locator('.hardware-visual').scrollIntoViewIfNeeded();await expect(page.locator('.hardware-canvas')).toHaveAttribute('data-explode','0.00');
  const refreshed=await measure();expect(refreshed.size).toEqual(first.size);expect(refreshed.live).toEqual(first.live);
  console.log('Matched product poster/live and refresh framing',width,height);await page.close();
 }
}finally{await browser.close()}
