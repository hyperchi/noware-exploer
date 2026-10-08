import http from 'node:http';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.js';
import {createSession,sessionCookie} from '../lib/session.js';
test('Cloud Run server protects assets and exposes only login and health',async()=>{
 process.env.SESSION_SECRET='test-only-secret'.repeat(4);
 const server=createApp().listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const withHost=(path,headers)=>new Promise((resolve,reject)=>{http.get(base+path,{headers},res=>{res.resume();resolve({status:res.statusCode,location:res.headers.location})}).on('error',reject)});
 try{
  for(const url of ['/','/board.json','/source/AirCube.kicad_pcb','/source/AirCube.kicad_sch','/models/esp32-h2-mini-1.json','/dashboard/','/dashboard/js/app.js','/dashboard/firmware/manifest.json']){
   const r=await fetch(base+url,{redirect:'manual'});assert.equal(r.status,303);assert.equal(r.headers.get('location'),'/login');
  }
  assert.equal((await fetch(base+'/api/health')).status,200);
  const direct=await withHost('/login?from=board',{host:'noware-1010426969452.us-central1.run.app'});assert.equal(direct.status,308);assert.equal(direct.location,'https://noware.so/login?from=board');
  const proxied=await withHost('/login',{host:'noware-1010426969452.us-central1.run.app','X-Noware-Public-Host':'noware.so'});assert.equal(proxied.status,200);
  assert.equal((await fetch(base+'/login')).status,200);
  const legacy=await fetch(base+'/login.html',{redirect:'manual'});assert.equal(legacy.status,308);assert.equal(legacy.headers.get('location'),'/login');
  const icon=await fetch(base+'/favicon.ico');assert.equal(icon.status,200);assert.match(icon.headers.get('content-type'),/image/);
  const token=await createSession({email:'person@noso.so',sub:'123'},{secret:process.env.SESSION_SECRET,domain:'noso.so'});
  const r=await fetch(base+'/board.json',{headers:{cookie:sessionCookie(token)}});assert.equal(r.status,200);assert.equal((await r.json()).tracks.length,301);assert.equal(r.headers.get('cache-control'),'private, no-store');
 }finally{await new Promise(r=>server.close(r));delete process.env.SESSION_SECRET;}
});
