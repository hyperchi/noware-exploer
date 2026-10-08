import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {scaleConfig as C,coinSupport} from '../src/scale/config.js';
test('assembled engineering bounds match comparison dimensions without scaling',async()=>{
 const bytes=fs.readFileSync(new URL('../public/showcase/aircube-base.glb',import.meta.url));
 const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 const bounds=new T.Box3();for(const name of ['housing','diffuser'])bounds.union(new T.Box3().setFromObject(gltf.scene.getObjectByName(name)));
 const size=bounds.getSize(new T.Vector3());assert.ok(Math.abs(size.x-C.dimensions.product.width)<.01);assert.ok(Math.abs(size.y-C.dimensions.product.height)<.01);assert.ok(Math.abs(size.z-C.dimensions.product.depth)<.01);
});
test('two real quarters remain slightly narrower than enclosure',()=>{assert.equal(C.dimensions.quarter.diameter*2,48.52);assert.ok(Math.abs(C.dimensions.product.width-48.52-.48)<1e-10)});
test('rolling coin support keeps cylinder above table throughout settlement',()=>{for(let i=0;i<=100;i++){const a=i/100*Math.PI/2,y=coinSupport(a);for(let j=0;j<120;j++){const py=12.13*Math.sin(j/120*Math.PI*2)*Math.sin(a);assert.ok(y+py-.875*Math.cos(a)>-1e-10)}}});

// A lookAt camera with world-up Y has a singularity when it reaches overhead.
// Exercise both ends and user-rotated views, including the exact final frame.
import {comparisonCameraPose} from '../src/scale/camera.js';
import {ease} from '../src/scale/config.js';
test('camera settles continuously at both ends, including after drag rotation',()=>{
 for(const yaw of [-.6,0,.6])for(const pitch of [-.18,0,.18])for(const reverse of [false,true]){
  const rotation={yaw,pitch};
  const sample=t=>comparisonCameraPose(reverse?1-ease(t):ease(t),1,rotation).orientation;
  let previous=sample(0),peak=0,lastStep=0;
  for(let i=1;i<=120;i++){const current=sample(i/120),step=previous.angleTo(current);assert.ok(Number.isFinite(step));assert.ok(step<.03,`Discontinuous camera step: ${step}`);peak=Math.max(peak,step);lastStep=step;previous=current}
  assert.ok(lastStep<peak*.025,'The final frame must ease to rest');
 }
});
test('footprint camera is exactly overhead with a stable north direction',()=>{
 const pose=comparisonCameraPose(1,1,{yaw:.6,pitch:.18});
 const forward=new T.Vector3(0,0,-1).applyQuaternion(pose.orientation);
 const up=new T.Vector3(0,1,0).applyQuaternion(pose.orientation);
 assert.ok(forward.distanceTo(new T.Vector3(0,-1,0))<1e-10);
 assert.ok(up.distanceTo(new T.Vector3(0,0,-1))<1e-10);
});
