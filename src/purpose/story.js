// Particle sensing is NOT present in the documented Base hardware.
// Keep environmental illustrations distinct from the device's verified VOC response.
export const roomChapters=[
 {name:'The room',title:'You can’t see most of what’s in your air.',body:'A room can look exactly the same while its air changes. AirCube continuously monitors VOCs, temperature, and humidity.',signal:'VOC monitoring',status:'Continuous'},
 {name:'Pets',title:'Pets change the air around them.',body:'Everyday movement can stir particles into the air. The particles shown here are illustrative; AirCube Base does not count particles or identify allergens.',signal:'VOC monitoring',status:'Continuous'},
 {name:'Dust',title:'Dust doesn’t stay on the floor.',body:'Disturb a cushion and particles can become airborne. This is an environmental illustration, not a particle reading from AirCube.',signal:'VOC monitoring',status:'Continuous'},
 {name:'The window',title:'Outside air becomes inside air.',body:'Opening a window changes the air moving through a room. AirCube monitors VOC conditions; it does not identify outdoor particles.',signal:'VOC monitoring',status:'Continuous'},
 {name:'Cooking',title:'Cooking can change your air in minutes.',body:'Cooking can release VOCs. AirCube responds to changes in these gases with a color-coded light, helping you notice when conditions change.',signal:'VOC indication',status:'Change illustrated'},
];
export const roomChapterAt=p=>Math.min(roomChapters.length-1,Math.floor(Math.max(0,Math.min(1,p))*roomChapters.length));
