// One scene unit is one millimeter. Never scale individual comparison objects.
export const scaleConfig = {
 dimensions: {product: {width:49,depth:49,height:32,retailHeight:36},quarter:{diameter:24.26,thickness:1.75,reeds:119},egg:{length:58,diameter:44}},
 timing:{reveal:2600,view:1000},
 camera:{compare:[95,125,175],overhead:[0,220,.001],target:[-13,12,6],span:174,mobileSpan:192,closeSpan:62},
 positions:{egg:[-64,0,4],coin:[46,0,29],footprintZ:44},
 quality:{pixelRatio:1.6,shadowSize:1024},
};
export const ease=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t)};
export const coinSupport=(tilt,radius=12.13,thickness=1.75)=>Math.abs(Math.sin(tilt))*radius+Math.abs(Math.cos(tilt))*thickness/2;
