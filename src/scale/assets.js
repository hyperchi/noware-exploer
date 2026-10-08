import * as T from 'three';
import {scaleConfig as C} from './config.js';
export function makeEgg(){
 const {length,diameter}=C.dimensions.egg,points=[];
 const samples=80,raw=Array.from({length:samples+1},(_,i)=>{const t=i/samples*Math.PI;return Math.sin(t)*(1-.17*Math.cos(t))}),max=Math.max(...raw);
 for(let i=0;i<=samples;i++)points.push(new T.Vector2(raw[i]/max*diameter/2,Math.cos(i/samples*Math.PI)*length/2));
 const geometry=new T.LatheGeometry(points.reverse(),64);geometry.rotateZ(Math.PI/2);geometry.computeVertexNormals();geometry.computeBoundingBox();
 const canvas=document.createElement('canvas');canvas.width=canvas.height=256;const ctx=canvas.getContext('2d'),data=ctx.createImageData(256,256);let seed=47;
 for(let i=0;i<data.data.length;i+=4){seed=(seed*1664525+1013904223)>>>0;const n=231+(seed%17);data.data.set([n,n,n,255],i)}ctx.putImageData(data,0,0);
 const texture=new T.CanvasTexture(canvas);texture.wrapS=texture.wrapT=T.RepeatWrapping;texture.repeat.set(3,2);
 const egg=new T.Mesh(geometry,new T.MeshStandardMaterial({color:'#f2e9db',roughness:.83,bumpMap:texture,bumpScale:.045}));egg.castShadow=egg.receiveShadow=true;egg.name='Approximate chicken egg';return egg;
}
export async function makeQuarter(){
 const {diameter,thickness,reeds}=C.dimensions.quarter,r=diameter/2;
 const group=new T.Group();group.name='US quarter — 24.26 × 1.75 mm';
 const metal=new T.MeshStandardMaterial({color:'#b8bbbd',metalness:.87,roughness:.32});
 const body=new T.Mesh(new T.CylinderGeometry(r-.09,r-.09,thickness-.1,128),metal);group.add(body);
 const image=await new T.TextureLoader().loadAsync('/showcase/scale/quarter.png');image.colorSpace=T.SRGBColorSpace;
 // Compress the photograph's baked mirror-black reflections into silver tones.
 // Keep the original grayscale as shallow relief so studio lights reveal the engraving.
 const silverCanvas=document.createElement('canvas');silverCanvas.width=silverCanvas.height=1024;
 const silverContext=silverCanvas.getContext('2d');silverContext.drawImage(image.image,0,0,1024,1024);
 const pixels=silverContext.getImageData(0,0,1024,1024);
 for(let i=0;i<pixels.data.length;i+=4){const luminance=(pixels.data[i]*.2126+pixels.data[i+1]*.7152+pixels.data[i+2]*.0722)/255;const tone=78+Math.pow(luminance,.8)*130;pixels.data[i]=tone;pixels.data[i+1]=tone+2;pixels.data[i+2]=tone+4;}
 silverContext.putImageData(pixels,0,0);const silver=new T.CanvasTexture(silverCanvas);silver.colorSpace=T.SRGBColorSpace;
 const face=new T.Mesh(new T.CircleGeometry(r-.26,128),new T.MeshStandardMaterial({map:silver,metalness:.8,roughness:.37,envMapIntensity:.65,bumpMap:image,bumpScale:.26}));face.rotation.x=-Math.PI/2;face.position.y=thickness/2-.025;group.add(face);
 for(const y of [-1,1]){const rim=new T.Mesh(new T.TorusGeometry(r-.13,.13,6,128),metal);rim.rotation.x=Math.PI/2;rim.position.y=y*(thickness/2-.13);group.add(rim)}
 const ridges=new T.InstancedMesh(new T.BoxGeometry(.12,thickness-.24,.13),metal,reeds),dummy=new T.Object3D();
 for(let i=0;i<reeds;i++){const a=i/reeds*Math.PI*2;dummy.position.set((r-.065)*Math.sin(a),0,(r-.065)*Math.cos(a));dummy.rotation.y=a;dummy.updateMatrix();ridges.setMatrixAt(i,dummy.matrix)}group.add(ridges);
 group.traverse(o=>{if(o.isMesh)o.castShadow=o.receiveShadow=true});return group;
}
