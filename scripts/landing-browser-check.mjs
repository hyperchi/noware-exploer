// Renders every homepage scene (desktop and mobile) in headless Chrome and reports console errors.
// Usage: node scripts/landing-browser-check.mjs [output-dir]
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import os from 'node:os';
const SP=process.argv[2]||os.tmpdir();
const server=await createServer({server:{port:8795},logLevel:'silent'});await server.listen();
const b=await chromium.launch({channel:'chrome',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const errs=[];
async function run(tag, viewport, mobile){
 const ctx=await b.newContext({viewport,isMobile:mobile,hasTouch:mobile,deviceScaleFactor:1});
 const p=await ctx.newPage();
 p.on('pageerror',e=>errs.push(tag+' pageerror: '+e.message));p.on('console',m=>{if(m.type()==='error'||m.type()==='warning')errs.push(tag+' console.'+m.type()+': '+m.text().slice(0,300))});
 await p.goto('http://localhost:8795/');
 await p.waitForFunction(()=>!document.querySelector('#stage-status').classList.contains('show'),null,{timeout:120000});
 await p.waitForTimeout(2500);
 const total=await p.evaluate(()=>document.querySelector('#showcase').offsetHeight-innerHeight);
 for(const [name,f] of [['s1',0.02],['s2',0.3],['s3',0.5],['s4',0.78],['s5',0.99]]){
  await p.evaluate(y=>scrollTo(0,y),Math.round(total*f));
  await p.waitForTimeout(2200);
  await p.screenshot({path:`${SP}/land-${tag}-${name}.png`});
  if(name==='s3'){await p.click('[data-state="poor"]');await p.waitForTimeout(2500);await p.screenshot({path:`${SP}/land-${tag}-s3-poor.png`});await p.click('[data-state="moderate"]');await p.waitForTimeout(2500);await p.screenshot({path:`${SP}/land-${tag}-s3-moderate.png`});await p.click('[data-state="good"]');}
 }
 const text=await p.evaluate(()=>({labels:[...document.querySelectorAll('.label')].map(l=>l.textContent.trim()).join(' | '), status:document.querySelector('#status-title').textContent}));
 console.log(tag, JSON.stringify(text).slice(0,500));
 await ctx.close();
}
await run('desk',{width:1440,height:900},false);
await run('mob',{width:390,height:844},true);
console.log('ERRORS:\n'+errs.join('\n'));
await b.close();await server.close();
