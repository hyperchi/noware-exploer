import express from 'express';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import auth from './api/auth.js';
import {cubeRouter,gatewayPrincipal} from './api/cube.js';
import {homeRouter} from './api/home.js';
import {contractorRouter} from './api/contractor.js';
import {createHomeStore} from './lib/home-store.js';
import {HomeService} from './lib/home-service.js';
import {demoEnabled,seedDemo} from './lib/demo-seed.js';
import {readSession,getCookie,SESSION_COOKIE,createSession,sessionCookie} from './lib/session.js';
import {ALLOWED_DOMAIN} from './lib/auth-policy.js';

export function createApp({cubeStore,onLive,onHistory,homeStore,homeService}={}){
 const app=express();
 const store=homeStore||createHomeStore();
 const service=homeService||new HomeService({store});
 app.locals.homeStore=store;app.locals.homeService=service;
 // Outside production, a first-time publisher joins the seeded demo home instead of getting a bare one.
 if(!service.beforeCreateHousehold)service.beforeCreateHousehold=email=>{if(demoEnabled())seedDemo({store,service,userEmail:email,timeZone:process.env.NOWARE_TIMEZONE||'America/Los_Angeles'})};
 const dist=fileURLToPath(new URL('./dist/',import.meta.url));
 app.disable('x-powered-by');
 app.use((req,res,next)=>{res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');res.setHeader('Cross-Origin-Opener-Policy','same-origin-allow-popups');next()});
 app.get('/api/health',(req,res)=>res.status(200).send('ok'));
 // This header controls canonical URLs only; authentication is always required.
 app.use((req,res,next)=>{
  if(req.hostname.endsWith('.run.app') && req.get('X-Noware-Public-Host')!=='noware.so')
   return res.redirect(308,'https://noware.so'+req.originalUrl);
  next();
 });
 app.all('/api/auth',express.json({limit:'20kb'}),auth);
 // Homepage: the public showcase for visitors, the full workspace with a session.
 app.get('/', async(req,res)=>{
  const session=await readSession(getCookie(req.headers.cookie,SESSION_COOKIE),{secret:process.env.SESSION_SECRET,domain:ALLOWED_DOMAIN});
  res.sendFile(path.join(dist,session?'index.html':'home.html'));
 });
 const publicStatic=dir=>express.static(path.join(dist,dir),{dotfiles:'deny',etag:false,lastModified:false,setHeaders:res=>res.setHeader('Cache-Control','public, max-age=86400')});
 app.use('/assets',publicStatic('assets'));
 app.use('/showcase',publicStatic('showcase'));
 // Local development only: DEV_LOGIN_EMAIL mints a session without Google.
 // Registered solely when NODE_ENV is not production, so it cannot exist on Cloud Run.
 if(process.env.DEV_LOGIN_EMAIL && process.env.NODE_ENV!=='production' && process.env.SESSION_SECRET){
  app.get('/dev-login',async(req,res)=>{const email=process.env.DEV_LOGIN_EMAIL.toLowerCase();res.setHeader('Set-Cookie',sessionCookie(await createSession({email,sub:'dev-login',name:email.split('@')[0]},{secret:process.env.SESSION_SECRET,domain:ALLOWED_DOMAIN})));res.redirect(303,'/dashboard/')});
 }
 app.get('/login', (req,res)=>res.sendFile(path.join(dist,'login.html')));
 app.get('/login.html', (req,res)=>res.redirect(308,'/login'));
 for(const file of ['login.js','favicon.ico'])app.get('/'+file,(req,res)=>res.sendFile(path.join(dist,file)));
 // Headless publishers (gateway/) authenticate with a bearer token from
 // GATEWAY_TOKENS; they may only reach the cube relay, never pages or files.
 app.use('/api/cube',(req,res,next)=>{const gateway=gatewayPrincipal(req);if(gateway){req.gateway=gateway;req.session={email:gateway.email,gateway:true};}next()});
 app.use(async(req,res,next)=>{
  if(req.gateway)return next();
  const session=await readSession(getCookie(req.headers.cookie,SESSION_COOKIE),{secret:process.env.SESSION_SECRET,domain:ALLOWED_DOMAIN});
  if(!session){if(req.path.startsWith('/api/'))return res.status(401).json({error:'Sign in required.'});return res.redirect(303,'/login');}
  req.session=session;
  next();
 });
 app.use('/api/cube',cubeRouter(cubeStore,{
  canPublish:(meta,email)=>{const h=meta.deviceKey&&store.householdOfDevice(meta.deviceKey);return !h||h.members.includes((email||'').toLowerCase())},
  onLive:(readings,cube)=>{service.onLive(readings,cube);onLive?.(readings,cube)},
  onHistory:(slots,cube)=>{service.onHistory(slots,cube);onHistory?.(slots,cube)},
 }));
 app.use('/api/home',homeRouter({store,service}));
 app.use('/api/contractor',contractorRouter({store,service}));
 app.use(express.static(dist,{dotfiles:'deny',etag:false,lastModified:false,setHeaders:res=>res.setHeader('Cache-Control','private, no-store')}));
 app.use((req,res)=>res.status(404).send('Not found'));
 app.use((err,req,res,next)=>{res.status(err.status===413?413:400).json({error:'Request could not be processed.'})});
 return app;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const app=createApp();
 const server=app.listen(Number(process.env.PORT)||8080,'0.0.0.0',()=>console.log('noware server ready'));
 const shutdown=()=>{try{app.locals.homeService.stopAll();app.locals.homeStore.flush();}catch{}server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),2000).unref();};
 process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
}
