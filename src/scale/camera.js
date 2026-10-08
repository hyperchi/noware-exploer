import * as T from 'three';
import {scaleConfig as C} from './config.js';

// Interpolate orientations, not a lookAt direction near its vertical pole.
// A fixed north direction keeps the orthographic footprint level at the endpoint.
export function comparisonCameraPose(progress,reveal,rotation){
 const orbitTarget=new T.Vector3(...C.camera.target);
 const orbit=new T.Spherical().setFromVector3(new T.Vector3(...C.camera.compare).sub(orbitTarget));
 orbit.theta+=rotation.yaw;orbit.phi+=rotation.pitch;
 const comparePosition=new T.Vector3().setFromSpherical(orbit).add(orbitTarget);
 const compareTarget=orbitTarget.clone().multiplyScalar(reveal);
 const overheadTarget=new T.Vector3(0,0,10);
 const overheadPosition=new T.Vector3(...C.camera.overhead).add(overheadTarget);
 const compareOrientation=new T.Quaternion().setFromRotationMatrix(new T.Matrix4().lookAt(comparePosition,compareTarget,new T.Vector3(0,1,0)));
 const overheadOrientation=new T.Quaternion().setFromRotationMatrix(new T.Matrix4().lookAt(overheadPosition,overheadTarget,new T.Vector3(0,0,-1)));
 return {
  position:comparePosition.lerp(overheadPosition,progress),
  orientation:compareOrientation.slerp(overheadOrientation,progress),
 };
}
