import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.js';
import {createSession,sessionCookie} from '../lib/session.js';
test('shared cube relay: publish, read back, one publisher at a time, login required',async()=>{
 process.env.SESSION_SECRET='test-only-secret'.repeat(4);
 const server=createApp().listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const cookie=sessionCookie(await createSession({email:'person@noso.so',sub:'123'},{secret:process.env.SESSION_SECRET,domain:'noso.so'}));
 const post=(path,body)=>fetch(base+'/api/cube'+path,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(body)});
 const get=(q='')=>fetch(base+'/api/cube'+q,{headers:{cookie}}).then(r=>r.json());
 try{
  assert.equal((await fetch(base+'/api/cube',{redirect:'manual'})).status,303);
  assert.equal((await get()).active,false);
  const now=Date.now()/1000;
  // Publisher clock runs 100 s behind; the server shifts its timestamps.
  const sentAt=now-100;
  const reading={timestamp:sentAt-1,temperatureC:22.5,humidity:54,etvoc:205,co2:640,isPro:true,fwVersion:'2.0.6',evil:'<script>'};
  let r=await post('/live',{publisher:'laptop-aaaa',sentAt,readings:[reading],meta:{name:'Office',isPro:true,fwVersion:'2.0.6',ledPercent:100}});
  assert.equal(r.status,200);assert.equal((await r.json()).needHistory,true);
  r=await post('/history',{publisher:'laptop-aaaa',sentAt,windowS:300,slots:[{sequence:1,timestamp:sentAt-600,co2Avg:500,junk:1},{sequence:2,timestamp:sentAt-300,co2Avg:510}]});
  assert.equal(r.status,200);
  const view=await get('?me=viewer-bbbb');
  assert.equal(view.active,true);assert.equal(view.yours,false);assert.equal(view.online,true);assert.equal(view.publisher,'person@noso.so');
  assert.equal(view.meta.name,'Office');assert.equal(view.live.length,1);assert.equal(view.live[0].evil,undefined);
  assert.ok(Math.abs(view.live[0].timestamp-(now-1))<5);
  assert.equal(view.slots.length,2);assert.equal(view.slots[0].junk,undefined);
  const again=await get(`?me=viewer-bbbb&history_version=${view.historyVersion}&live_since=${view.live[0].timestamp}`);
  assert.equal(again.slots,undefined);assert.equal(again.live.length,0);
  assert.equal((await get('?me=laptop-aaaa')).yours,true);
  r=await post('/live',{publisher:'laptop-cccc',sentAt:now,readings:[reading]});
  assert.equal(r.status,409);assert.equal((await r.json()).publisher,'person@noso.so');
  assert.equal((await post('/live',{publisher:'x',sentAt:now})).status,400);
 }finally{await new Promise(r=>server.close(r));delete process.env.SESSION_SECRET;}
});
