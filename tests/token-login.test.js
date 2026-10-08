import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readSession,getCookie,SESSION_COOKIE} from '../lib/session.js';
import handler from '../api/auth.js';
function response(){return {statusCode:200,headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},status(n){this.statusCode=n;return this;},json(data){this.body=data;return this;}}}
const request=body=>({url:'/api/auth?action=token',method:'POST',headers:{origin:'https://noware.so','content-type':'application/json'},body});
test('popup access-token sign-in verifies audience and identity with Google',async()=>{
 process.env.SESSION_SECRET='test-only-secret'.repeat(4);process.env.GOOGLE_CLIENT_ID='test-client';
 const originalFetch=globalThis.fetch;
 const tokens={
  'good-token-aaaaaaaaaaaaaaaaaaa':{aud:'test-client',sub:'42',email:'winston@noso.so',email_verified:'true',hd:'noso.so',expires_in:'3000'},
  'wrong-aud-aaaaaaaaaaaaaaaaaaaa':{aud:'someone-else',sub:'42',email:'winston@noso.so',email_verified:'true',hd:'noso.so',expires_in:'3000'},
  'gmail-token-aaaaaaaaaaaaaaaaaa':{aud:'test-client',sub:'7',email:'random@gmail.com',email_verified:'true',expires_in:'3000'},
 };
 globalThis.fetch=async url=>{const u=new URL(String(url));assert.equal(u.origin+u.pathname,'https://oauth2.googleapis.com/tokeninfo');const info=tokens[u.searchParams.get('access_token')];return info?Response.json(info):new Response('{"error":"invalid_token"}',{status:400});};
 try{
  const ok=response();await handler(request({accessToken:'good-token-aaaaaaaaaaaaaaaaaaa'}),ok);assert.equal(ok.statusCode,200);
  const session=await readSession(getCookie(ok.headers['set-cookie'].join('; '),SESSION_COOKIE),{secret:process.env.SESSION_SECRET,domain:'noso.so'});assert.equal(session.email,'winston@noso.so');
  const aud=response();await handler(request({accessToken:'wrong-aud-aaaaaaaaaaaaaaaaaaaa'}),aud);assert.equal(aud.statusCode,401);
  const gmail=response();await handler(request({accessToken:'gmail-token-aaaaaaaaaaaaaaaaaa'}),gmail);assert.equal(gmail.statusCode,403);
  const bogus=response();await handler(request({accessToken:'nope-aaaaaaaaaaaaaaaaaaaaaaaaa'}),bogus);assert.equal(bogus.statusCode,401);
  const short=response();await handler(request({accessToken:'x'}),short);assert.equal(short.statusCode,401);
 }finally{globalThis.fetch=originalFetch;delete process.env.SESSION_SECRET;delete process.env.GOOGLE_CLIENT_ID;}
});
