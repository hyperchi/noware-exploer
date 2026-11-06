import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.js';
import {createHomeStore} from '../lib/home-store.js';

// Mirrors CloudHomeStore's surface -- a `ready` promise plus a `loadCloud()`
// that re-attempts it -- failing the first `failures` attempts.
function flakyStore(failures){
 const store=createHomeStore();
 store.attempts=0;
 store.loadCloud=()=>{
  store.attempts++;
  const p=store.attempts<=failures
   ? Promise.reject(new Error('Runtime identity unavailable (403)'))
   : Promise.resolve();
  p.catch(()=>{}); // the app attaches its own handlers; keep the probe quiet
  return p;
 };
 store.ready=store.loadCloud();
 return store;
}

async function serve(store){
 process.env.SESSION_SECRET='test-only-secret'.repeat(4);
 const server=createApp({homeStore:store}).listen(0,'127.0.0.1');
 await new Promise(resolve=>server.once('listening',resolve));
 return {server,base:'http://127.0.0.1:'+server.address().port};
}

test('health reports process liveness even when air storage is unreachable',async()=>{
 const {server,base}=await serve(flakyStore(Infinity));
 try{
  // Liveness must not depend on GCS: gating it made a storage outage look like
  // a dead deployment and blinded the deploy smoke test, which asserts 200.
  assert.equal((await fetch(base+'/api/health')).status,200);
  // Everything behind the gate still fails closed.
  const gated=await fetch(base+'/login');
  assert.equal(gated.status,503);
  assert.equal((await gated.json()).error,'Air data storage unavailable.');
 }finally{server.close()}
});

test('an unreachable bucket does not crash the process at startup',async()=>{
 // `ready` rejects before any request attaches a handler. Node exits on an
 // unhandled rejection by default, so this must stay handled from creation.
 const {server,base}=await serve(flakyStore(Infinity));
 try{
  await new Promise(resolve=>setTimeout(resolve,50));
  assert.equal((await fetch(base+'/api/health')).status,200);
 }finally{server.close()}
});

test('a storage outage recovers without a redeploy',async()=>{
 const store=flakyStore(2); // attempt 1 at startup, attempt 2 on first request
 const {server,base}=await serve(store);
 try{
  assert.equal((await fetch(base+'/login')).status,503);
  assert.equal(store.attempts,2);
  // The next request re-attempts the load instead of serving the latched
  // rejection for the life of the process. 503 is the only status under test:
  // the page itself needs a built dist/, which unit tests do not have.
  assert.notEqual((await fetch(base+'/login')).status,503);
  assert.equal(store.attempts,3);
 }finally{server.close()}
});
