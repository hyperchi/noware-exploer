const clamp=n=>Math.max(0,Math.min(1,n));
export const ease=n=>{n=clamp(n);return n*n*(3-2*n)};
export const illustrationDuration=24;
// Ambient paths pass through the room, rather than ending at a suction point.
// The cooking path passes just above the physical enclosure, then continues past it.
export const roomFlowPaths=[
 [[-.9,.25,1],[-.8,.85,1.15],[.2,.9,1.1],[1.3,1.2,1.1]],
 [[-1.73,.7,-.99],[-1.4,1.1,-.1],[-.8,1.25,.65],[.1,1.4,1.3]],
 [[-2.55,1.3,-.35],[-1.6,1.55,.2],[-.3,1.45,.55],[1.35,1.6,.8]],
 [[1.65,.96,-1.42],[1.4,1.3,-.6],[.95,.85,.15],[.55,.575,.78],[.3,.7,1.3]],
];
export function flowActivity(progress,source){
 const start=[.13,.33,.53,.72][source],end=[.39,.59,.8,.95][source];
 return ease((progress-start)/.065)*(1-ease((progress-end)/.065));
}
export function detectionPose(progress){
 const arrival=ease((progress-.74)/.1);
 const sensing=ease((progress-.84)/.025)*(1-ease((progress-.95)/.05));
 const response=ease((progress-.865)/.045)*(1-ease((progress-.95)/.05));
 const phase=progress<.74?'monitoring':progress<.84?'air':progress<.865?'sensing':progress<.95?'signal':'settling';
 return {arrival,sensing,response,phase};
}
