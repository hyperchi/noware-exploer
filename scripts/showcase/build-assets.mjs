// node scripts/showcase/build-assets.mjs /path/to/AirCube (pinned commit in README)
import fs from 'node:fs';
import path from 'node:path';
import * as T from 'three';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import occtImport from 'occt-import-js';
const root=process.argv[2];if(!root)throw Error('Pass AirCube checkout');
globalThis.FileReader=class {readAsArrayBuffer(b){b.arrayBuffer().then(r=>{this.result=r;this.onloadend?.()})} readAsDataURL(b){b.arrayBuffer().then(r=>{this.result='data:application/octet-stream;base64,'+Buffer.from(r).toString('base64');this.onloadend?.()})}};
const occt=await occtImport();const assembly=new T.Group();assembly.name='AirCube_Base';
const mat=(color,roughness=.48,metalness=0)=>new T.MeshStandardMaterial({color,roughness,metalness});
function geometry(m){const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(m.attributes.position.array,3));g.setIndex(m.index.array);g.computeVertexNormals();g.translate(-46.5,58.5,3);g.rotateX(-Math.PI/2);return g;}
function read(file){const r=occt.ReadStepFile(fs.readFileSync(path.join(root,file)),{linearUnit:'millimeter',linearDeflection:.065,angularDeflection:.3});if(!r.success)throw Error(file);return r;}
for(const [name,file,color]of [['housing','AirCube bottom_prod_12-11.step','#e7e6de'],['diffuser','AirCube_top-8-31-26.step','#ecf6de'],['airwall','AirCube_air_wall_8-31-26.step','#e6e4d9']]){const r=read('mechanical/base/STEP/'+file);const mesh=new T.Mesh(mergeGeometries(r.meshes.map(geometry)),mat(color));mesh.name=name;assembly.add(mesh);}
const pcb=new T.Group();pcb.name='pcb';assembly.add(pcb);
const r=read('kicad/Base/AirCube.step');
for(const [i,m]of r.meshes.entries()){const mesh=new T.Mesh(geometry(m).translate(0,0,-5),mat(i===51?'#16634d':m.name?.startsWith('C_')?'#b4a387':m.name?.startsWith('R_')?'#252b29':'#b6b9a9',.48,i===51?0:.3));mesh.name=i===51?'board':'package_'+i;pcb.add(mesh);}
const data=JSON.parse(fs.readFileSync('public/showcase/board.json'));
// Enclosure CAD origin is offset 5 mm in Y from the board STEP and KiCad.
for(const [ref,name]of [['U7','esp32-h2-mini-1'],['U2','ens161'],['U10','ens210'],['P1','usb4105'],['U6','sot23-5'],['S2','rkb2']]){const c=data.components.find(c=>c.ref===ref),d=JSON.parse(fs.readFileSync('public/models/'+name+'.json'));const group=new T.Group();group.name=ref;
 for(const m of d.meshes){const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(m.positions,3));g.setIndex(m.indices);g.computeVertexNormals();g.translate(0,0,d.dimensions[2]/2);g.rotateZ((c.at[2]||0)*Math.PI/180);g.rotateX(-Math.PI/2);group.add(new T.Mesh(g,mat(m.color?new T.Color(...m.color):'#999e9b',.4,.35)));}
 group.position.set(c.at[0]-46.5,4.6,c.at[1]-63.5);pcb.add(group);
}
// Source-derived copper routing; no photograph textures or unlicensed assets.
const lines=[];for(const t of data.tracks.filter(t=>t.layer==='F.Cu'&&t.start&&t.end)){for(const p of [t.start,t.end])lines.push(p[0]-46.5,4.615,p[1]-63.5)}
const traces=new T.LineSegments(new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(lines,3)),new T.LineBasicMaterial({color:'#568b6b'}));traces.name='copper';pcb.add(traces);
// Merge meshes by material within each selectable group; keep assembly hierarchy intact.
function optimize(group){for(const child of [...group.children])if(child.isGroup)optimize(child);const buckets=new Map();for(const mesh of [...group.children]){if(!mesh.isMesh)continue;const key=JSON.stringify(mesh.material.toJSON().color)+':'+mesh.material.roughness+':'+mesh.material.metalness;const bucket=buckets.get(key)||[];bucket.push(mesh);buckets.set(key,bucket)}for(const meshes of buckets.values()){if(meshes.length<2)continue;const merged=new T.Mesh(mergeGeometries(meshes.map(m=>m.geometry)),meshes[0].material);merged.name=group.name+'_details';meshes.forEach(m=>group.remove(m));group.add(merged)}}
optimize(pcb);
assembly.updateMatrixWorld(true);const out=await new GLTFExporter().parseAsync(assembly,{binary:true});fs.writeFileSync('public/showcase/aircube-base.glb',Buffer.from(out));console.log('GLB',out.byteLength,'bytes');
fs.copyFileSync(path.join(root,'LICENSE'),'public/showcase/AIRCUBE-LICENSE.txt');
