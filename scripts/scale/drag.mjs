import {chromium,expect} from '@playwright/test';
const b=await chromium.launch({channel:'chrome',headless:true}),errors=[];
for(const mobile of [false,true]){
 const p=await b.newPage({viewport:mobile?{width:390,height:844}:{width:1440,height:900},hasTouch:mobile,reducedMotion:'reduce'});p.on('pageerror',e=>errors.push(e.message));
 await p.goto(process.env.TEST_URL||'http://127.0.0.1:5177/home.html');await p.locator('.hardware-size-link').click();const host=p.locator('.scale-canvas'),canvas=host.locator('canvas');await expect(host).toHaveAttribute('data-ready','true');
 const rect=await canvas.boundingBox(),x=rect.x+rect.width/2,y=rect.y+rect.height/2;
 if(mobile){const cdp=await p.context().newCDPSession(p);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});for(let i=1;i<=10;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+i*8,y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
 else {await p.mouse.move(x,y);await p.mouse.down();await p.mouse.move(x+150,y+45,{steps:15});await p.mouse.up()}
 await expect(host).not.toHaveAttribute('data-rotation','0.000,0.000');const rotation=await host.getAttribute('data-rotation');await p.locator('#size').screenshot({path:`captures/scale/drag-${mobile?'mobile':'desktop'}.png`});
 await p.locator('[data-mode=footprint]').click();await expect(host).toHaveAttribute('data-view','1.000');await expect(p.locator('.scale-reset')).toBeDisabled();await canvas.focus();await p.keyboard.press('ArrowRight');await expect(host).toHaveAttribute('data-rotation',rotation);
 await p.locator('[data-mode=compare]').click();await expect(host).toHaveAttribute('data-view','0.000');await expect(host).toHaveAttribute('data-rotation',rotation);await p.locator('.scale-reset').click();await expect(host).toHaveAttribute('data-rotation','0.000,0.000');await canvas.focus();await p.keyboard.press('ArrowRight');await expect(host).toHaveAttribute('data-rotation','0.080,0.000');await p.locator('.scale-reset').click();
 if(mobile){const cdp=await p.context().newCDPSession(p);const before=await p.evaluate(()=>scrollY);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});for(let i=1;i<=10;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-i*12}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await p.waitForTimeout(200);if(await p.evaluate(()=>scrollY)<=before)throw Error('Vertical touch scroll blocked');await expect(host).toHaveAttribute('data-rotation','0.000,0.000')}
 console.log('Passed',mobile?'mobile touch rotation and normal scroll':'desktop drag','footprint lock, view restoration, reset and keyboard');await p.close();
}
await b.close();if(errors.length)throw Error(errors.join('\n'));
