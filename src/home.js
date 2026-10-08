// Public homepage for visitors without a session: the 3D hardware showcase,
// with the engineering tools replaced by a sign-in prompt. Signed-in users
// get index.html / main.js, where the same showcase sits above the playground.
import './style.css';
import {mountShowcase} from './showcase/index.js';
document.querySelector('#app').innerHTML=`<header><a class="brand" href="/"><strong>Noware</strong><span> / </span><span>Hardware playground</span></a><div class="header-right"><a class="github" href="/login">Sign in</a></div></header>
<div class="intro"><div><div class="eyebrow">NOSO / HARDWARE WORKSPACE</div><h1>Sign in to open the engineering tools.</h1><p>The full PCB explorer, air simulator, component library and the live office cube are available to Noso accounts and approved guests.</p></div><div class="intro-actions"><a href="/login" class="primary">Sign in with Google →</a></div></div>
<main hidden></main>
<footer><span>Built from real hardware. Made for curiosity. Made in America.</span><div><a href="https://github.com/hyperchi/AirCube" target="_blank" rel="noreferrer">Open hardware ↗</a></div></footer>`;
mountShowcase();
