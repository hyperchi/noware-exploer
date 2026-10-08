// Public homepage for visitors without a session: the 3D hardware showcase,
// with the engineering tools replaced by a sign-in prompt. Signed-in users
// get index.html / main.js, where the same showcase sits above the playground.
import './style.css';
import {mountShowcase} from './showcase/index.js';
import {mountScaleComparison} from './scale/index.js';
document.querySelector('#app').innerHTML=`<header><a class="brand" href="/"><strong>Noware</strong><span> / </span><span>Hardware playground</span></a><div class="header-right"><a class="github" href="/login">Sign in</a></div></header>
<div class="intro"><div><div class="eyebrow">NOSO / HARDWARE WORKSPACE</div><h1>Sign in to open the engineering tools.</h1><p>The full PCB explorer, air simulator, component library and the live office cube are available to Noso accounts and approved guests.</p></div><div class="intro-actions"><a href="/login" class="primary">Sign in with Google →</a></div></div>
<main hidden></main>
<footer><span>Built from real hardware. Made for curiosity. Made in America.</span><div><a href="https://github.com/hyperchi/AirCube" target="_blank" rel="noreferrer">Open hardware ↗</a></div></footer>`;
mountShowcase();
mountScaleComparison();

// Login opens Google's account chooser directly from the click, signs in, and
// reloads into the workspace. If Google's script is not ready, fall back to /login.
const loginLink=document.querySelector('header .hardware-login')||document.querySelector('header a[href="/login"]');
let tokenClient=null;
(async()=>{
 try{
  const config=await fetch('/api/auth?action=config').then(r=>r.ok?r.json():null);
  if(!config)return;
  await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://accounts.google.com/gsi/client';s.async=true;s.onload=resolve;s.onerror=reject;document.head.append(s);});
  tokenClient=google.accounts.oauth2.initTokenClient({client_id:config.clientId,scope:'openid email profile',prompt:'select_account',
   callback:async response=>{
    if(!response?.access_token){location.href='/login';return;}
    const r=await fetch('/api/auth?action=token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accessToken:response.access_token})});
    if(r.ok)location.reload();else{const data=await r.json().catch(()=>({}));alert(data.error||'Sign-in failed.');}
   },
   error_callback:()=>{}});
 }catch{}
})();
loginLink?.addEventListener('click',e=>{if(!tokenClient)return;e.preventDefault();tokenClient.requestAccessToken();});
