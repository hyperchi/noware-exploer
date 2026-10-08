import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {scaleConfig as C,ease,coinSupport} from './config.js';
import {makeEgg,makeQuarter} from './assets.js';
import {comparisonCameraPose} from './camera.js';
export async function createComparison(host,state){
 const renderer=new T.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true});
 renderer.setPixelRatio(Math.min(devicePixelRatio,C.quality.pixelRatio));renderer.setClearColor('#fff',0);renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=.85;renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFShadowMap;
 const {product:pd,quarter:qd}=C.dimensions;
 const scene=new T.Scene(),camera=new T.OrthographicCamera(-100,100,70,-70,.1,600);
 const pmrem=new T.PMREMGenerator(renderer),room=new RoomEnvironment(),env=pmrem.fromScene(room,.04);scene.environment=env.texture;scene.environmentIntensity=.65;room.dispose();pmrem.dispose();
 let dead=false,raf=0,started=false,visible=false,view=0,from=0,to=0,viewStart=0,revealStart=0,pausedAt=0;
 const events=new AbortController();
 const materials=new Set(),textures=new Set(),geometries=new Set();
 function dispose(){dead=true;events.abort();cancelAnimationFrame(raf);resizeObserver?.disconnect();observer?.disconnect();document.removeEventListener('visibilitychange',visibility);scene.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[]){materials.add(m);for(const v of Object.values(m))if(v?.isTexture)textures.add(v)}});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());env.dispose();renderer.dispose();renderer.domElement.remove()}
 let resizeObserver,observer,wake=()=>{};
 const visibility=()=>{if(document.hidden||!visible){if(!pausedAt)pausedAt=performance.now();cancelAnimationFrame(raf);raf=0}else{if(pausedAt){const elapsed=performance.now()-pausedAt;revealStart+=elapsed;viewStart+=elapsed;pausedAt=0}wake()}};
 try{
 const [gltf,coin]=await Promise.all([new GLTFLoader().loadAsync('/showcase/aircube-base.glb'),makeQuarter()]);
 const product=gltf.scene;scene.add(product);product.traverse(o=>{if(o.isMesh)o.castShadow=o.receiveShadow=true});
 const bounds=new T.Box3();for(const name of ['housing','diffuser'])bounds.union(new T.Box3().setFromObject(product.getObjectByName(name)));
 const size=bounds.getSize(new T.Vector3());if(Math.abs(size.x-pd.width)>.05||Math.abs(size.y-pd.height)>.05||Math.abs(size.z-pd.depth)>.05)throw Error('Enclosure bounds differ from configured dimensions');
 product.position.y=-bounds.min.y;
 host.dataset.bounds=[size.x,size.z,size.y].map(n=>n.toFixed(2)).join(' × ');
 const diffuser=product.getObjectByName('diffuser');diffuser.material.dispose();diffuser.material=new T.MeshPhysicalMaterial({color:new T.Color('#faf8eb').lerp(new T.Color('#91d980'),.55),roughness:.5,metalness:0,transmission:.08,thickness:1.3,ior:1.45,emissive:'#91d980',emissiveIntensity:.28});
 diffuser.material.onBeforeCompile=shader=>{shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vShellPosition;').replace('#include <begin_vertex>','#include <begin_vertex>\nvShellPosition = position;');shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vShellPosition;').replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\nfloat diffusion = 1.0 - smoothstep(10.0, 33.0, vShellPosition.y);\ntotalEmissiveRadiance *= 0.35 + diffusion * 1.5;\ndiffuseColor.rgb *= 0.995 + 0.005 * sin(vShellPosition.y * 35.0);');};
 const egg=makeEgg(),coin2=coin.clone(true);scene.add(egg,coin,coin2);
 scene.add(new T.HemisphereLight('#fffef7','#b0b6ba',.4));const key=new T.DirectionalLight('#fffaf0',2);key.position.set(-70,130,80);key.castShadow=true;key.shadow.mapSize.set(C.quality.shadowSize,C.quality.shadowSize);Object.assign(key.shadow.camera,{left:-125,right:125,top:110,bottom:-110,near:1,far:350});key.shadow.normalBias=.06;key.shadow.bias=-.0001;key.shadow.radius=4;scene.add(key);const fill=new T.DirectionalLight('#e2ebf5',.65);fill.position.set(80,50,-60);scene.add(fill);
 const ground=new T.Mesh(new T.PlaneGeometry(1000,1000),new T.ShadowMaterial({opacity:.085}));ground.rotation.x=-Math.PI/2;ground.position.y=-.02;ground.receiveShadow=true;scene.add(ground);
 const linePoints=[[-24.5,.08,-32],[24.5,.08,-32],[-24.5,.08,-34],[-24.5,.08,-30],[24.5,.08,-34],[24.5,.08,-30],[32,.08,-24.5],[32,.08,24.5],[30,.08,-24.5],[34,.08,-24.5],[30,.08,24.5],[34,.08,24.5]];
 const lines=new T.LineSegments(new T.BufferGeometry().setFromPoints(linePoints.map(([x,y,z])=>new T.Vector3(x/49*pd.width,y,z/49*pd.depth))),new T.LineBasicMaterial({color:'#737373',transparent:true}));scene.add(lines);
 host.append(renderer.domElement);const canvas=renderer.domElement;canvas.tabIndex=0;canvas.setAttribute('aria-keyshortcuts','ArrowLeft ArrowRight ArrowUp ArrowDown');renderer.domElement.setAttribute('role','img');renderer.domElement.setAttribute('aria-label','Noware enclosure, chicken egg and US quarter shown together at a consistent physical scale. In Compare view, drag or use arrow keys to rotate the shared view.');
 function render(now){raf=0;if(dead||!visible||document.hidden)return;
 const rt=state.reduced||state.mobile?1:Math.min(1,(now-revealStart)/C.timing.reveal),r=ease(rt),v=state.reduced?1:ease((now-viewStart)/C.timing.view);view=T.MathUtils.lerp(from,to,v);
 const w=host.clientWidth,h=host.clientHeight,aspect=w/h,vertical=T.MathUtils.lerp(C.camera.closeSpan,Math.max((state.mobile?C.camera.mobileSpan:C.camera.span)/aspect,state.mobile?150:118),r);camera.left=-vertical*aspect/2;camera.right=vertical*aspect/2;camera.top=vertical/2;camera.bottom=-vertical/2;
 const pose=comparisonCameraPose(view,r,state.rotation);camera.position.copy(pose.position);camera.quaternion.copy(pose.orientation);camera.updateProjectionMatrix();
 egg.rotation.set(0,.12*(1-view),0);egg.rotation.x=(1-r)*.3;egg.position.set(C.positions.egg[0]-(1-r)*20-view*3,0,C.positions.egg[2]);egg.updateMatrixWorld();egg.position.y=-new T.Box3().setFromObject(egg).min.y;
 const settle=ease((rt-.35)/.65),tilt=(1-settle)*Math.PI/2+Math.sin(settle*Math.PI*6)*.08*Math.sin(settle*Math.PI);coin.rotation.set(tilt,(1-settle)*Math.PI*2,0);coin.position.set(T.MathUtils.lerp(C.positions.coin[0]+(1-settle)*55,-qd.diameter/2,view),coinSupport(tilt,qd.diameter/2,qd.thickness),T.MathUtils.lerp(C.positions.coin[2],C.positions.footprintZ,view));
 coin2.visible=view>.001;coin2.position.set(T.MathUtils.lerp(110,qd.diameter/2,view),qd.thickness/2,C.positions.footprintZ);
 lines.material.opacity=ease((view-.65)/.35);lines.visible=view>.65;
 camera.updateMatrixWorld(true);scene.updateMatrixWorld(true);for(const label of host.parentElement.querySelectorAll('[data-scale-anchor]')){const anchors={width:[0,0,-39],depth:[40,0,0],coins:[0,0,64]};const p=new T.Vector3(...anchors[label.dataset.scaleAnchor]).project(camera);label.style.left=`${(p.x*.5+.5)*w}px`;label.style.top=`${(-p.y*.5+.5)*h}px`;label.style.opacity=lines.material.opacity;label.hidden=view<.65}
 renderer.render(scene,camera);host.dataset.rotation=state.rotation.yaw.toFixed(3)+','+state.rotation.pitch.toFixed(3);canvas.dataset.draggable=String(to===0&&view<.001);host.dataset.ready='true';host.dataset.view=view.toFixed(3);host.dataset.reveal=rt.toFixed(3);host.dataset.drawCalls=renderer.info.render.calls;host.parentElement.classList.add('is-ready');
 if(rt<1||v<1)raf=requestAnimationFrame(render);
 }
 wake=()=>{if(!raf&&!dead&&visible&&!document.hidden)raf=requestAnimationFrame(render)};
 let drag=null;
 function rotate(yaw,pitch){state.rotation.yaw=T.MathUtils.clamp(yaw,-C.interaction.yawLimit,C.interaction.yawLimit);state.rotation.pitch=T.MathUtils.clamp(pitch,-C.interaction.pitchLimit,C.interaction.pitchLimit);revealStart=performance.now()-C.timing.reveal;wake()}
 function endDrag(){if(drag&&canvas.hasPointerCapture(drag.id))canvas.releasePointerCapture(drag.id);drag=null;delete canvas.dataset.dragging}
 canvas.addEventListener('pointerdown',e=>{if(e.button!==0||to!==0||view>.001)return;drag={id:e.pointerId,x:e.clientX,y:e.clientY,...state.rotation};},{signal:events.signal});
 canvas.addEventListener('pointermove',e=>{if(!drag||e.pointerId!==drag.id)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(e.pointerType==='touch'&&!canvas.hasPointerCapture(e.pointerId)){if(Math.abs(dy)>Math.abs(dx)&&Math.abs(dy)>5){endDrag();return}if(Math.abs(dx)<5)return}canvas.setPointerCapture(e.pointerId);canvas.dataset.dragging='true';rotate(drag.yaw-dx*C.interaction.dragSpeed,drag.pitch-(e.pointerType==='touch'?0:dy*C.interaction.dragSpeed));},{signal:events.signal});
 for(const type of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(type,endDrag,{signal:events.signal});
 canvas.addEventListener('keydown',e=>{if(to!==0||view>.001||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();rotate(state.rotation.yaw+({ArrowLeft:-1,ArrowRight:1}[e.key]||0)*C.interaction.keyStep,state.rotation.pitch+({ArrowUp:-1,ArrowDown:1}[e.key]||0)*C.interaction.keyStep);},{signal:events.signal});
 function reset(){endDrag();rotate(0,0)}
 function resize(){state.mobile=innerWidth<600;renderer.setSize(host.clientWidth,host.clientHeight);wake()}
 resizeObserver=new ResizeObserver(resize);resizeObserver.observe(host);
 observer=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;if(visible&&!started){started=true;pausedAt=0;revealStart=performance.now();viewStart=revealStart-C.timing.view}visibility()},{threshold:.15});observer.observe(host);document.addEventListener('visibilitychange',visibility);resize();
 return {reset,setMode(mode){endDrag();from=view;to=mode==='footprint'?1:0;viewStart=performance.now();revealStart=viewStart-C.timing.reveal;wake()},replay(){endDrag();state.rotation.yaw=state.rotation.pitch=0;from=view;to=0;viewStart=performance.now();revealStart=viewStart;wake()},dispose};
 }catch(error){dispose();throw error}
}
