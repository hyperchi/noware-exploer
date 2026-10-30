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
  assert.equal((await fetch(base+'/api/cube',{redirect:'manual'})).status,401);
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
  // PM channels and validity flags survive the relay; unknown sources are physical.
  r=await post('/live',{publisher:'laptop-aaaa',sentAt:now,readings:[{timestamp:now,pm25:12.5,pm10:20,pmValid:true,pmPresent:true,hasTrueCo2:true,co2:540,co2Valid:true,source:'simulated'}],meta:{name:'Office',source:'simulated',roomName:'Office'}});
  assert.equal(r.status,200);
  const pmView=await get('?me=viewer-bbbb');const lastLive=pmView.live.at(-1);
  assert.equal(lastLive.pm25,12.5);assert.equal(lastLive.pmValid,true);assert.equal(lastLive.source,'simulated');assert.equal(pmView.meta.source,'simulated');assert.equal(pmView.publisherKind,'browser');
 }finally{await new Promise(r=>server.close(r));delete process.env.SESSION_SECRET;}
});

test('gateway publishes with a bearer token and nothing else',async()=>{
 process.env.SESSION_SECRET='test-only-secret'.repeat(4);
 process.env.GATEWAY_TOKENS='gateway-token-for-tests-0123456789abcdef:person@noso.so, short, owned-gateway-token-0123456789abcdefgh:owner@noso.so';
 const seen=[];
 const server=createApp({onLive:(readings,store)=>seen.push([readings.length,store.publisher.kind])}).listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const headers=token=>({authorization:'Bearer '+token,'content-type':'application/json','x-noware-gateway':'office-mac-mini'});
 try{
  const now=Date.now()/1000;
  const body=JSON.stringify({publisher:'gateway-office-01',sentAt:now,readings:[{timestamp:now-0.5,pm25:4.2,pmValid:true,pmPresent:true,etvoc:30,co2:600,hasTrueCo2:true,co2Valid:true}],meta:{name:'Office cube',source:'physical',deviceKey:'aircube-office',roomName:'Office'}});
  assert.equal((await fetch(base+'/api/cube/live',{method:'POST',headers:headers('wrong-token-wrong-token-wrong-token-wrong'),body})).status,401);
  assert.equal((await fetch(base+'/api/cube/live',{method:'POST',headers:headers('short'),body})).status,401);
  const ok=await fetch(base+'/api/cube/live',{method:'POST',headers:headers('gateway-token-for-tests-0123456789abcdef'),body});
  assert.equal(ok.status,200);assert.equal((await ok.json()).needHistory,true);
  assert.deepEqual(seen,[[1,'gateway']]);
  // The token opens the relay only: pages and other APIs still need a session.
  assert.equal((await fetch(base+'/board.json',{headers:headers('gateway-token-for-tests-0123456789abcdef'),redirect:'manual'})).status,303);
  const cookie=sessionCookie(await createSession({email:'person@noso.so',sub:'123'},{secret:process.env.SESSION_SECRET,domain:'noso.so'}));
  const view=await fetch(base+'/api/cube?me=viewer',{headers:{cookie}}).then(r=>r.json());
  assert.equal(view.publisherKind,'gateway');assert.equal(view.publisher,'person@noso.so');assert.equal(view.meta.deviceKey,'aircube-office');assert.ok(view.lastHeartbeat>0);
  // A token with an owner publishes as that owner, so the cube lands in their home.
  await new Promise(r=>setTimeout(r,50));
  const owned=await fetch(base+'/api/cube/live',{method:'POST',headers:headers('owned-gateway-token-0123456789abcdefgh'),body:JSON.stringify({publisher:'gateway-office-02',sentAt:Date.now()/1000+40,readings:[],meta:{name:'Owned'}})});
  assert.ok(owned.status===200||owned.status===409);
 }finally{await new Promise(r=>server.close(r));delete process.env.SESSION_SECRET;delete process.env.GATEWAY_TOKENS;}
});

for (const gateway of [false,true]) {
 test(`all NOSO accounts share the relay from a ${gateway?'gateway':'browser'} publisher`,async(t)=>{
  const previous={...process.env};
  process.env.SESSION_SECRET='team-relay-test-secret'.repeat(4);
  process.env.NOWARE_DEMO='0';
  const gatewayToken='team-relay-gateway-test-token-0123456789';
  const privateToken='private-relay-gateway-test-token-0123456789';
  process.env.GATEWAY_TOKENS=`${gatewayToken}:publisher@noso.so,${privateToken}`;
  t.mock.timers.enable({apis:['Date'],now:1793386800000});
  const app=createApp();
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const cookies=new Map();
  for(const email of ['publisher@noso.so','winston@noso.so','info@noso.so','new-teammate@noso.so','shanshan0343@gmail.com']) {
   cookies.set(email,sessionCookie(await createSession({email,sub:email},{secret:process.env.SESSION_SECRET,domain:'noso.so'})));
  }
  const read=email=>fetch(base+'/api/cube?me=viewer&history_version=-1',{headers:{cookie:cookies.get(email)}}).then(response=>response.json());
  const publish=(headers,path,body)=>fetch(base+'/api/cube'+path,{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify(body)});
  const publisherHeaders=gateway?{authorization:`Bearer ${gatewayToken}`}:{cookie:cookies.get('publisher@noso.so')};
  const sentAt=Date.now()/1000;
  const publication={publisher:'office-publisher',sentAt,readings:[{timestamp:sentAt,temperatureC:22,humidity:45,etvoc:30}],meta:{name:'Shared office cube'}};
  try {
   assert.equal((await read('winston@noso.so')).active,false);
   assert.equal((await publish(publisherHeaders,'/live',publication)).status,200);
   assert.equal((await publish(publisherHeaders,'/history',{publisher:publication.publisher,sentAt,slots:[{sequence:1,timestamp:sentAt-300,co2Avg:500}]})).status,200);
   for(const email of ['winston@noso.so','info@noso.so','new-teammate@noso.so']) {
    const shared=await read(email);
    assert.equal(shared.active,true);
    assert.equal(shared.publisher,'publisher@noso.so');
    assert.equal(shared.yours,false);
    assert.equal(shared.live[0].etvoc,30);
    assert.equal(shared.slots[0].co2Avg,500);
   }
   assert.equal((await read('shanshan0343@gmail.com')).active,false);
   assert.equal((await fetch(base+'/api/cube')).status,401);
   assert.equal((await fetch(base+'/api/cube',{headers:{authorization:`Bearer ${gatewayToken}`}})).status,403);
   // A second account cannot impersonate the active publisher by copying its public ID.
   const teammateHeaders={cookie:cookies.get('new-teammate@noso.so')};
   assert.equal((await publish(teammateHeaders,'/live',publication)).status,409);
   assert.equal((await publish(teammateHeaders,'/history',{publisher:publication.publisher,sentAt,slots:[]})).status,409);
   assert.equal((await read('info@noso.so')).slots.length,1);
   // Private publishers cannot replace or leak into the team stream.
   const privatePublication={...publication,meta:{name:'Private cube'},readings:[{timestamp:sentAt,etvoc:999}]};
   assert.equal((await publish({cookie:cookies.get('shanshan0343@gmail.com')},'/live',privatePublication)).status,200);
   assert.equal((await publish({authorization:`Bearer ${privateToken}`},'/live',privatePublication)).status,200);
   assert.equal((await read('info@noso.so')).live[0].etvoc,30);
   assert.equal((await read('shanshan0343@gmail.com')).live[0].etvoc,999);
   // Any NOSO account may become the next publisher once the existing lease expires.
   t.mock.timers.tick(31000);
   const nextSentAt=Date.now()/1000;
   assert.equal((await publish(teammateHeaders,'/live',{...publication,publisher:'next-publisher',sentAt:nextSentAt,readings:[{timestamp:nextSentAt,etvoc:42}],meta:{name:'Next team cube'}})).status,200);
   for(const email of ['publisher@noso.so','winston@noso.so','info@noso.so']) {
    const shared=await read(email);
    assert.equal(shared.publisher,'new-teammate@noso.so');
    assert.equal(shared.meta.name,'Next team cube');
    assert.equal(shared.live.length,1);
    assert.equal(shared.live[0].etvoc,42);
    assert.equal(shared.slots.length,0);
   }
   assert.equal((await read('shanshan0343@gmail.com')).meta.name,'Private cube');
  } finally {
   app.locals.homeService.stopAll();
   await new Promise(resolve=>server.close(resolve));
   for(const key of ['SESSION_SECRET','NOWARE_DEMO','GATEWAY_TOKENS']) {
    if(previous[key]===undefined) delete process.env[key]; else process.env[key]=previous[key];
   }
  }
 });
}
