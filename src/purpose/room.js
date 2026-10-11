import * as T from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
const smooth=x=>{x=T.MathUtils.clamp(x,0,1);return x*x*(3-2*x)};
export async function createRoom(host,state,onReady){
 const renderer=new T.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));renderer.setClearColor('#fff',0);renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1;renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFShadowMap;
 const scene=new T.Scene(),camera=new T.OrthographicCamera(-3,3,2,-2,.01,60);let resizeObserver,observer;let dead=false,visible=false,raf=0,last=performance.now(),time=0,progress=state.progress;
 const envMaker=new T.PMREMGenerator(renderer),studio=new RoomEnvironment(),env=envMaker.fromScene(studio,.04);scene.environment=env.texture;scene.environmentIntensity=.35;studio.dispose();envMaker.dispose();
 const materials={wall:new T.MeshStandardMaterial({color:'#f7f5ef',roughness:.9}),floor:new T.MeshStandardMaterial({color:'#e5ddd0',roughness:.82}),fabric:new T.MeshStandardMaterial({color:'#c7c6b9',roughness:.96}),pillow:new T.MeshStandardMaterial({color:'#b0b6a0',roughness:1}),wood:new T.MeshStandardMaterial({color:'#a98b68',roughness:.65}),ivory:new T.MeshStandardMaterial({color:'#f4f0e6',roughness:.7}),metal:new T.MeshStandardMaterial({color:'#5e6463',metalness:.7,roughness:.32}),glass:new T.MeshPhysicalMaterial({color:'#e6eff3',transmission:.25,transparent:true,opacity:.25,roughness:.2}),leaf:new T.MeshStandardMaterial({color:'#6d8065',roughness:.9}),fur:new T.MeshStandardMaterial({color:'#b89d80',roughness:1})};
 function box(w,h,d,x,y,z,mat,r=.025,parent=scene){const o=new T.Mesh(new RoundedBoxGeometry(w,h,d,2,Math.min(r,w/3,h/3,d/3)),mat);o.position.set(x,y,z);o.castShadow=o.receiveShadow=true;parent.add(o);return o}
 function ball(w,h,d,x,y,z,mat,parent=scene){const o=new T.Mesh(new T.SphereGeometry(1,24,16),mat);o.scale.set(w,h,d);o.position.set(x,y,z);o.castShadow=o.receiveShadow=true;parent.add(o);return o}
 function cylinder(rt,rb,h,x,y,z,mat,parent=scene){const o=new T.Mesh(new T.CylinderGeometry(rt,rb,h,32),mat);o.position.set(x,y,z);o.castShadow=o.receiveShadow=true;parent.add(o);return o}
 function tube(points,r,mat,parent=scene){const o=new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p))),32,r,8,false),mat);o.castShadow=true;parent.add(o);return o}
 box(5.3,.08,3.85,0,-.04,0,materials.floor,.01);
 // Quiet plank seams, not a texture download.
 const seamMat=new T.LineBasicMaterial({color:'#d4cabb',transparent:true,opacity:.35});const seam=[];for(let i=-2.4;i<2.6;i+=.3)seam.push(new T.Vector3(i,.003,-1.9),new T.Vector3(i,.003,1.9));scene.add(new T.LineSegments(new T.BufferGeometry().setFromPoints(seam),seamMat));
 box(5.3,2.6,.075,0,1.3,-1.92,materials.wall,.006);
 // Window opening is actual empty space in the left wall.
 box(.075,.8,3.85,-2.65,.4,0,materials.wall,.006);box(.075,.4,3.85,-2.65,2.4,0,materials.wall,.006);box(.075,1.4,.7,-2.65,1.5,-1.57,materials.wall,.006);box(.075,1.4,1.3,-2.65,1.5,1.27,materials.wall,.006);
 box(.13,.07,2,-2.61,.84,-.35,materials.ivory,.01);box(.13,.065,2,-2.61,2.18,-.35,materials.ivory,.01);
 const sash=new T.Group();sash.position.set(-2.6,.84,-1.3);scene.add(sash);box(.04,1.32,.04,0,.66,0,materials.ivory,.006,sash);box(.04,1.32,.04,0,.66,1.9,materials.ivory,.006,sash);box(.04,.04,1.9,0,1.32,.95,materials.ivory,.006,sash);box(.04,.04,1.9,0,0,.95,materials.ivory,.006,sash);box(.015,1.24,1.82,0,.66,.95,materials.glass,.003,sash);
 // Sofa: visible seams, separate cushions, low timber base.
 box(2.05,.15,.8,-1.14,.19,-.97,materials.wood,.04);box(2.13,.58,.18,-1.14,.6,-1.31,materials.fabric,.06);for(const x of [-2.13,-.15])box(.2,.5,.85,x,.47,-.96,materials.fabric,.06);
 for(const x of [-1.65,-.68]){box(.91,.18,.68,x,.36,-.87,materials.fabric,.07);const cushion=box(.9,.47,.14,x,.65,-1.14,materials.fabric,.065);cushion.rotation.x=-.1}
 const pillow=box(.38,.34,.17,-1.73,.59,-.99,materials.pillow,.075);pillow.rotation.z=.18;pillow.rotation.x=-.1;
 const rugMat=new T.MeshStandardMaterial({color:'#eeece4',roughness:1});box(2.75,.012,1.75,-.7,.012,.57,rugMat,.006);
 // Minimal oak coffee table and a book.
 box(1,.055,.55,-.8,.35,.48,materials.wood,.1);for(const x of [-1.15,-.45])for(const z of [.31,.66])cylinder(.022,.018,.3,x,.17,z,materials.wood);
 box(.23,.02,.17,-.94,.393,.5,materials.ivory,.005);box(.22,.015,.16,-.91,.412,.52,materials.pillow,.005);
 box(.7,.72,.035,-1.05,1.8,-1.86,materials.wood,.012);box(.64,.66,.012,-1.05,1.8,-1.833,materials.ivory,.003);
 const printLine=new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(-1.25,1.67,-1.822),new T.Vector3(-1.04,1.95,-1.822),new T.Vector3(-.86,1.73,-1.822)]),new T.LineBasicMaterial({color:'#a8b0a0'}));scene.add(printLine);
 // Natural placement: AirCube on a small table at the room's near edge.
 cylinder(.29,.29,.055,.53,.49,.8,materials.wood);cylinder(.035,.055,.46,.53,.23,.8,materials.wood);
 tube([[.52,.52,.79],[.38,.505,.76],[.28,.46,.77],[.27,.12,.79],[.3,.014,.97],[.7,.013,1.4]],.003,materials.ivory);
 const plant=new T.Group();plant.position.set(-2.25,0,-1.55);scene.add(plant);cylinder(.15,.1,.25,0,.125,0,materials.ivory,plant);for(let i=0;i<7;i++){const a=i*2.4,tip=[Math.sin(a)*.22,.75+(i%3)*.16,Math.cos(a)*.22];tube([[0,.2,0],[tip[0]*.5,.5,tip[2]*.5],tip],.008,materials.leaf,plant);const leaf=ball(.09,.2,.025,...tip,materials.leaf,plant);leaf.rotation.z=Math.sin(a)*.7;leaf.rotation.y=a}
 // Rear kitchen keeps cooking in the same room, with no scene cut.
 box(1.5,.79,.57,1.65,.395,-1.45,materials.ivory,.018);box(1.58,.045,.66,1.65,.812,-1.42,materials.wood,.015);for(const x of [1.18,1.67,2.17]){box(.45,.67,.015,x,.4,-1.153,materials.wall,.004);box(.15,.015,.022,x,.65,-1.133,materials.metal,.006)}
 box(.53,.014,.38,1.65,.841,-1.42,materials.metal,.02);const pan=cylinder(.14,.125,.065,1.65,.884,-1.42,materials.metal);box(.25,.025,.035,1.89,.885,-1.42,materials.metal,.012);
 box(.8,.38,.38,1.66,2.07,-1.72,materials.ivory,.012);
 // A small original procedural cat. Its motion is deterministic, not simulated physics.
 const cat=new T.Group();scene.add(cat);ball(.23,.13,.11,0,.19,0,materials.fur,cat);ball(.11,.11,.09,.2,.27,0,materials.fur,cat);ball(.065,.045,.065,.27,.25,0,materials.fur,cat);
 for(const z of [-.062,.062]){const ear=new T.Mesh(new T.ConeGeometry(.045,.09,3),materials.fur);ear.position.set(.18,.38,z);ear.rotation.z=-.2;cat.add(ear);ball(.009,.012,.008,.285,.29,z,materials.metal,cat)}
 const paws=[];for(const x of [-.14,.14])for(const z of [-.065,.065])paws.push(box(.043,.15,.044,x,.08,z,materials.fur,.02,cat));tube([[-.2,.22,0],[-.36,.3,0],[-.43,.48,.02],[-.39,.53,.03]],.025,materials.fur,cat);
 const particleCount=120,positions=new Float32Array(particleCount*3),particleGeo=new T.BufferGeometry();particleGeo.setAttribute('position',new T.BufferAttribute(positions,3));
 const dot=document.createElement('canvas');dot.width=dot.height=32;const ctx=dot.getContext('2d'),gradient=ctx.createRadialGradient(16,16,0,16,16,16);gradient.addColorStop(0,'#fff');gradient.addColorStop(.5,'#ffffffbb');gradient.addColorStop(1,'#ffffff00');ctx.fillStyle=gradient;ctx.fillRect(0,0,32,32);const dotTexture=new T.CanvasTexture(dot);
 const particles=new T.Points(particleGeo,new T.PointsMaterial({size:2.2,map:dotTexture,color:'#778b90',transparent:true,opacity:0,depthWrite:false,sizeAttenuation:false}));scene.add(particles);
 scene.add(new T.HemisphereLight('#fffaf0','#d4d5d0',1));const sunlight=new T.DirectionalLight('#fff4df',2.6);sunlight.position.set(-3.5,6,3);sunlight.castShadow=true;sunlight.shadow.mapSize.set(2048,2048);Object.assign(sunlight.shadow.camera,{left:-4,right:4,top:4,bottom:-4,near:.5,far:16});sunlight.shadow.bias=-.0003;sunlight.shadow.normalBias=.015;scene.add(sunlight);const fill=new T.DirectionalLight('#e5efff',.6);fill.position.set(4,3,4);scene.add(fill);
 let product;try{product=(await new GLTFLoader().loadAsync('/showcase/aircube-base.glb')).scene;}catch(error){dispose();throw error}
 product.scale.setScalar(.001);product.position.set(.53,.518,.8);product.rotation.y=.3;product.traverse(o=>{if(o.isMesh)o.castShadow=o.receiveShadow=true});scene.add(product);
 const diffuser=product.getObjectByName('diffuser');diffuser.material.dispose();diffuser.material=new T.MeshPhysicalMaterial({color:'#c8dfb9',roughness:.5,transmission:.08,thickness:.0013,emissive:'#91d980',emissiveIntensity:.3});
 const canvas=renderer.domElement;canvas.setAttribute('role','img');canvas.setAttribute('aria-label','A shared living room with a sofa, cat, openable window, kitchen and AirCube on a side table. Air movement is illustrated.');host.append(canvas);
 const anchor=host.parentElement.querySelector('.room-device-label');
 function render(now){raf=0;if(dead||!visible||document.hidden)return;const dt=Math.min(.06,(now-last)/1000);last=now;time+=dt;progress=state.reduced?state.progress:T.MathUtils.damp(progress,state.progress,9,dt);
 const chapter=Math.min(4,Math.floor(progress*5)),local=progress*5-chapter,activity=smooth(local*2);
 const walking=chapter===1?activity:chapter>1?1:0;cat.position.set(T.MathUtils.lerp(-1.7,-.78,walking),.025,1.03);cat.rotation.y=-.13;for(let i=0;i<paws.length;i++)paws[i].rotation.z=chapter===1&&!state.reduced?Math.sin(time*6+i%2*Math.PI)*.22*(1-activity):0;
 pillow.rotation.z=.18+(chapter===2?Math.sin(local*Math.PI*4)*.16*Math.sin(local*Math.PI):0);pillow.position.y=.59+(chapter===2?Math.sin(local*Math.PI*2)**2*.11:0);sash.rotation.y=chapter===3?-.48*activity:chapter>3?-.48:0;
 const show=(chapter>0?Math.min(1,activity*1.5):smooth((local-.35)*3))*(1-smooth((local-.82)/.18));particles.material.opacity=show*.45;
 const sources=[[-.6,.3,.4],[-.9,.15,1],[-1.73,.7,-.99],[-2.55,1.3,-.35],[1.65,.94,-1.42]];const origin=sources[chapter];
 for(let i=0;i<particleCount;i++){const seed=(Math.sin(i*12.9898+3)*43758.5453)%1+.5,life=((seed+(state.reduced?0:time*.065))%1+1)%1,a=i*1.74533;positions[i*3]=origin[0]+Math.cos(a+life)*(.12+life*.8)+(chapter===3?life*2.3:chapter===4?-life*.7:life*.2);positions[i*3+1]=origin[1]+life*(chapter===4?1:.65)+Math.sin(a)*.07;positions[i*3+2]=origin[2]+Math.sin(a)*life*.7+(chapter===4?life*1.1:0)}particleGeo.attributes.position.needsUpdate=true;
 const target=new T.Vector3(-.15,1.05,0),aspect=host.clientWidth/host.clientHeight,span=innerWidth<700?6.4:6;const vertical=Math.max(span/aspect,5.7);camera.left=-vertical*aspect/2;camera.right=vertical*aspect/2;camera.top=vertical/2;camera.bottom=-vertical/2;camera.position.set(5,4.4,6.8);if(!state.reduced){camera.position.x-=progress*.3;target.z+=progress*.07}camera.lookAt(target);camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
 const point=new T.Vector3(.53,.57,.8).project(camera);anchor.style.left=`${(point.x*.5+.5)*host.clientWidth}px`;anchor.style.top=`${(-point.y*.5+.5)*host.clientHeight}px`;
 // Only a verified VOC scene may illustrate the light changing; particle-only scenes do not drive it.
 const response=chapter===4?smooth(local*3)*(1-smooth((local-.7)/.3)):0;const tint=new T.Color('#91d980').lerp(new T.Color('#e6bd61'),response);diffuser.material.emissive.lerp(tint,state.reduced?1:1-Math.exp(-dt*4));
 renderer.render(scene,camera);host.dataset.chapter=chapter;host.dataset.ready='true';host.dataset.progress=progress.toFixed(3);host.parentElement.classList.add('room-ready');onReady?.(chapter,local);
 if(!state.reduced||Math.abs(progress-state.progress)>.001)raf=requestAnimationFrame(render);
 }
 function wake(){if(!raf&&!dead&&visible&&!document.hidden){last=performance.now();raf=requestAnimationFrame(render)}}
 function resize(){if(!host.clientWidth||!host.clientHeight)return;renderer.setSize(host.clientWidth,host.clientHeight);wake()}
 resizeObserver=new ResizeObserver(resize);resizeObserver.observe(host);observer=new IntersectionObserver(([e])=>{visible=e.isIntersecting;if(visible)wake();else{cancelAnimationFrame(raf);raf=0}},{rootMargin:'50px'});observer.observe(host);
 function visibility(){if(document.hidden){cancelAnimationFrame(raf);raf=0}else wake()}document.addEventListener('visibilitychange',visibility);resize();
 function dispose(){dead=true;cancelAnimationFrame(raf);resizeObserver?.disconnect();observer?.disconnect();document.removeEventListener('visibilitychange',visibility);const gs=new Set(),ms=new Set(),ts=new Set();scene.traverse(o=>{if(o.geometry)gs.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[]){ms.add(m);for(const v of Object.values(m))if(v?.isTexture)ts.add(v)}});gs.forEach(g=>g.dispose());ms.forEach(m=>m.dispose());ts.forEach(t=>t.dispose());env.dispose();renderer.dispose();renderer.domElement.remove()}
 return {wake,dispose};
}
