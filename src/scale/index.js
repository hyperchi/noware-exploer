import './scale.css';
import {scaleConfig as C} from './config.js';
export function mountScaleComparison(){
 const d=C.dimensions.product;
 const section=document.createElement('section');section.className='scale-story';section.id='size';section.hidden=true;section.setAttribute('aria-labelledby','scale-title');
 section.innerHTML=`<button type="button" class="scale-close" aria-label="Close size comparison">Close <span aria-hidden="true">×</span></button><div class="scale-heading"><span class="scale-eyebrow">A LITTLE PERSPECTIVE</span><h2 id="scale-title" tabindex="-1">Wait. It’s that small?</h2><p>About two quarters wide.</p></div>
 <div class="scale-stage"><picture><source media="(max-width:600px)" srcset="/showcase/scale/compare-mobile.webp"><img class="scale-poster" src="/showcase/scale/compare.webp" alt="Noware beside a chicken egg and a U.S. quarter, shown at relative scale." width="1440" height="600"></picture><div class="scale-canvas"></div><div class="scale-measure" data-scale-anchor="width" hidden>${d.width} mm</div><div class="scale-measure" data-scale-anchor="depth" hidden>${d.depth} mm</div><div class="scale-measure scale-coin-label" data-scale-anchor="coins" hidden>${(C.dimensions.quarter.diameter*2).toFixed(2)} mm · two quarters</div></div>
 <div class="scale-toolbar"><div class="scale-modes" role="group" aria-label="Size comparison view"><button type="button" data-mode="compare" aria-pressed="true">Compare</button><button type="button" data-mode="footprint" aria-pressed="false">Show the footprint</button></div><button type="button" class="scale-replay" aria-label="Replay the size comparison reveal">Replay <span aria-hidden="true">↻</span></button></div>
 <div class="scale-caption"><p>${d.width} × ${d.depth} × ${d.height} mm <span>· modeled enclosure</span></p><p>Objects shown at relative scale. Egg size approximate.</p><details><summary>About the dimensions</summary><p>The engineering enclosure shown measures 49 × 49 × 32 mm. The retail product lists 49 × 49 × 36 mm. This comparison preserves the engineering model’s proportions. The egg is an illustrative 58 × 44 mm; each U.S. quarter is 24.26 mm across and 1.75 mm thick.</p><p>Quarter-dollar coin image from the United States Mint.</p></details><p class="scale-status" role="status"></p></div>`;
 document.querySelector('#hardware').after(section);
 const media=matchMedia('(prefers-reduced-motion: reduce)'),state={mode:'compare',reduced:media.matches,mobile:innerWidth<600};let scene,disposed=false;
 const trigger=document.querySelector('.hardware-size-link');
 function setOpen(open){section.hidden=!open;trigger.setAttribute('aria-expanded',String(open));const target=open?section.querySelector('h2'):trigger;target.focus({preventScroll:true});(open?section:trigger).scrollIntoView({behavior:state.reduced?'instant':'smooth',block:open?'start':'center'});}
 const toggle=()=>setOpen(section.hidden);trigger.addEventListener('click',toggle);
 section.querySelector('.scale-close').addEventListener('click',()=>setOpen(false));
 section.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();setOpen(false)}});
 const buttons=[...section.querySelectorAll('[data-mode]')],poster=section.querySelector('.scale-poster'),source=section.querySelector('source');
 function update(mode){state.mode=mode;buttons.forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===mode)));poster.src=`/showcase/scale/${mode}.webp`;source.srcset=`/showcase/scale/${mode}-mobile.webp`;poster.alt=mode==='footprint'?'Overhead comparison: the 49 mm enclosure above two quarters spanning 48.52 mm, with an egg alongside.':'Noware beside a chicken egg and a U.S. quarter, shown at relative scale.';scene?.setMode(mode)}
 buttons.forEach(b=>b.addEventListener('click',()=>update(b.dataset.mode)));
 section.querySelector('.scale-replay').addEventListener('click',()=>{update('compare');scene?.replay()});
 const preference=()=>{state.reduced=media.matches;scene?.setMode(state.mode)};media.addEventListener('change',preference);
 const observer=new IntersectionObserver(async([e])=>{if(!e.isIntersecting)return;observer.disconnect();try{const {createComparison}=await import('./scene.js');scene=await createComparison(section.querySelector('.scale-canvas'),state);if(disposed){scene.dispose();return}if(state.mode!=='compare')scene.setMode(state.mode)}catch(error){console.warn('Size comparison uses its image fallback:',error.message);section.querySelector('.scale-status').textContent='Still views shown. The same relative scale is preserved.';section.querySelector('.scale-replay').hidden=true;}},{rootMargin:'400px'});observer.observe(section);
 const dispose=()=>{disposed=true;trigger.removeEventListener('click',toggle);observer.disconnect();scene?.dispose();media.removeEventListener('change',preference)};
 if(import.meta.hot)import.meta.hot.dispose(dispose);
 return dispose;
}
