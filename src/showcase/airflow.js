import * as T from 'three';
import {settings} from './config.js';

// Ambient streamlines skirt the enclosure's exterior (49 mm footprint).
// They never cross a solid wall or imply a fan, filter, or measured particle count.
export function makeAirflow(){
 const group=new T.Group();group.name='ambient-air';
 const uniforms={time:{value:0},tint:{value:new T.Color('#627e81')}};
 const material=new T.ShaderMaterial({
  uniforms,transparent:true,depthWrite:false,side:T.FrontSide,
  vertexShader:`uniform float time;varying vec2 flowUV;varying float edgeSoftness;
   void main(){flowUV=uv;vec3 p=position;
    p.y+=sin(position.x*0.13+position.z*0.08-time*0.9)*0.45;
    vec4 view=modelViewMatrix*vec4(p,1.0);
    edgeSoftness=pow(abs(dot(normalize(normalMatrix*normal),normalize(-view.xyz))),0.7);
    gl_Position=projectionMatrix*view;}`,
  fragmentShader:`uniform float time;uniform vec3 tint;varying vec2 flowUV;varying float edgeSoftness;
   void main(){
    float u=flowUV.x;
    float pulse=pow(0.5+0.5*cos((u-time*0.12)*25.1327),12.0);
    float fade=smoothstep(0.0,0.10,u)*(1.0-smoothstep(0.87,1.0,u));
    float alpha=(0.10+pulse*0.78)*fade*edgeSoftness;
    gl_FragColor=vec4(tint,alpha);
    #include <colorspace_fragment>
   }`
 });
 const curves=[];
 // Five long paths travel around the visible front and right side, then past
 // the sensing-side corner. Depth and spacing vary gently, without turbulence.
 for(let i=0;i<5;i++){
  const spread=i*2.0;
  curves.push(new T.CatmullRomCurve3([
   new T.Vector3(-39,10+spread,29+spread),
   new T.Vector3(-27,8+spread,31+spread),
   new T.Vector3(-3,7+spread,29+spread),
   new T.Vector3(22,8+spread,30+spread),
   new T.Vector3(30+spread,10+spread,15),
   new T.Vector3(29+spread,8+spread,-9),
   new T.Vector3(28+spread,7+spread,-29),
   new T.Vector3(32+spread,9+spread,-38)
  ],false,'centripetal'));
 }
 // Two quieter paths approach the sensing opening from the open exterior.
 for(let i=0;i<2;i++)curves.push(new T.CatmullRomCurve3([
  new T.Vector3(48,9+i*3,-34),new T.Vector3(39,11+i*3,-29),
  new T.Vector3(30,9+i*2,-26),new T.Vector3(24.9,7+i,-22.5)
 ]));
 const samples=curves.map((curve,i)=>{
  const mesh=new T.Mesh(new T.TubeGeometry(curve,100,i<5?.14:.19,5,false),material);
  mesh.frustumCulled=false;group.add(mesh);
  return curve.getPoints(240);
 });
 const count=innerWidth<700?Math.round(settings.flowCount*.55):settings.flowCount;
 const positions=new Float32Array(count*3);
 const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.BufferAttribute(positions,3));
 const pointsMaterial=new T.ShaderMaterial({
  uniforms,transparent:true,depthWrite:false,
  vertexShader:`varying float softness;
   void main(){vec4 p=modelViewMatrix*vec4(position,1.0);gl_Position=projectionMatrix*p;
    gl_PointSize=clamp(230.0/-p.z,1.5,3.5);softness=0.65;}`,
  fragmentShader:`uniform vec3 tint;varying float softness;
   void main(){float radius=length(gl_PointCoord-0.5)*2.0;
    float alpha=(1.0-smoothstep(0.15,1.0,radius))*softness;
    gl_FragColor=vec4(tint,alpha);
    #include <colorspace_fragment>
   }`
 });
 const points=new T.Points(geometry,pointsMaterial);points.frustumCulled=false;group.add(points);
 const neutral=new T.Color('#526e75'),v=new T.Vector3();
 return {group,update(time,tint,reduced){
  const t=reduced?0:time;uniforms.time.value=t;
  uniforms.tint.value.copy(neutral).lerp(tint,.18);
  for(let i=0;i<count;i++){
   const lane=i%samples.length,list=samples[lane];
   const phase=(i*.61803398875+t*(lane<5?.085:.12))%1;
   const n=phase*240,index=Math.floor(n);
   v.copy(list[index]).lerp(list[Math.min(index+1,240)],n-index);
   // Tiny coherent drift, confined to the exterior clearance.
   v.y+=Math.sin(i*2.3+t*.7)*.35;
   v.toArray(positions,i*3);
  }
  geometry.attributes.position.needsUpdate=true;
 }};
}
