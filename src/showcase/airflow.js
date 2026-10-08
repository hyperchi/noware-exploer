import * as T from 'three';
import {settings} from './config.js';
// Exterior paths stop outside the front ventilation gap. No claimed internal fluid path.
export function makeAirflow(){const group=new T.Group(),curves=[];const color=new T.Color('#91d980');
 for(let i=0;i<3;i++){const c=new T.CatmullRomCurve3([new T.Vector3(44+i*3,11+i*2,-38),new T.Vector3(36,12+i*2,-31),new T.Vector3(28,9+i,-28),new T.Vector3(22,7+i*.4,-23)]);curves.push(c);const g=new T.BufferGeometry().setFromPoints(c.getPoints(60));group.add(new T.Line(g,new T.LineBasicMaterial({color:color.clone().multiplyScalar(.48),transparent:true,opacity:.4})));}
 const positions=new Float32Array(settings.flowCount*3);const geo=new T.BufferGeometry();geo.setAttribute('position',new T.BufferAttribute(positions,3));const material=new T.PointsMaterial({color,size:.48,transparent:true,opacity:.8,depthWrite:false});group.add(new T.Points(geo,material));const v=new T.Vector3();
 return {group,update(time,tint,reduced){material.color.copy(tint);for(let i=0;i<settings.flowCount;i++){curves[i%3].getPoint((i/settings.flowCount+(reduced?0:time*.13))%1,v);v.toArray(positions,i*3)}geo.attributes.position.needsUpdate=true;}};
}
