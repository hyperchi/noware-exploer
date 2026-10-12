import {test} from 'node:test';
import assert from 'node:assert/strict';
import {detectionPose,flowActivity} from '../src/purpose/flow.js';
test('Particle indication follows illustrated air arrival and sensor response, then settles',()=>{
 assert.equal(detectionPose(.8).response,0);
 assert.equal(detectionPose(.845).arrival,1);
 assert.equal(detectionPose(.845).response,0);
 assert.equal(detectionPose(.89).sensing,1);
 assert.ok(detectionPose(.89).response>0);
 assert.equal(detectionPose(1).response,0);
 for(const offset of [0,.2,.4,.6]){assert.equal(detectionPose(.22+offset).response,0);assert.ok(detectionPose(.29+offset).response>0);assert.ok(detectionPose(.3999+offset).response<.001)}
 for(let i=0;i<200;i++)assert.equal(detectionPose(i/1000).sensing,0);
});
test('successive air illustrations overlap instead of switching emitters abruptly',()=>{
 for(const [p,a,b] of [[.38,0,1],[.58,1,2],[.77,2,3]]){assert.ok(flowActivity(p,a)>0);assert.ok(flowActivity(p,b)>0)}
 for(let i=0;i<=1000;i++)for(let source=0;source<4;source++){const v=flowActivity(i/1000,source);assert.ok(v>=0&&v<=1)}
});
