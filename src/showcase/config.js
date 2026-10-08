export const settings={camera:[83,65,98],target:[0,19,0],fov:35,explode:{diffuser:39,airwall:23,pcb:12},colors:{good:'#91d980',attention:'#edc35b',poor:'#e87969'},pixelRatio:{desktop:1.7,mobile:1.3},flowCount:280};
export const chapters=[
 ['01','A little presence.','A clearer picture of the air around you. Explore the hardware behind a simple signal.'],
 ['02','Nothing to hide.','Lift the diffuser. Meet the board, the sensors, and the small details that make it work.'],
 ['03','Open to the air.','Ambient air reaches the sensing area. The ENS161 responds to volatile organic compounds.'],
 ['04','One quiet signal.','From soft green to warm yellow and red. Try the light, and see the difference.'],
 ['05','Made for curiosity.','From the enclosure to every connection. A little object, designed to be understood.']
];
export const components={diffuser:['Translucent diffuser','Softens the light from the board’s RGB LEDs into a glanceable indication.'],airwall:['Air wall','The printed partition separates the sensing area from the rest of the enclosure.'],pcb:['Base PCB','The source board brings sensing, control, USB power, and three RGB LEDs together.'],U2:['ENS161 · VOC sensor','Responds to volatile organic compounds. Its CO₂ estimate is not a direct CO₂ measurement.'],U10:['ENS210 · Temperature & humidity','Measures temperature and relative humidity on the Base variant.'],U7:['ESP32-H2 · Controller','Runs the sensor and LED firmware, with Bluetooth LE and IEEE 802.15.4 connectivity.'],housing:['Printed housing','The original CAD includes the USB opening, ventilation gaps, rounded corners, and mounting features.']};
export function storyPose(progress){const p=Math.max(0,Math.min(1,progress));const smooth=x=>{x=Math.max(0,Math.min(1,x));return x*x*(3-2*x)};return {explode:smooth((p-.12)/.2)*(1-smooth((p-.6)/.2)),chapter:Math.min(4,Math.floor(p*5))};}
