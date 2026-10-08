/* The homepage 3D showcase: a noware cube built from the real enclosure STEP
 * files and the Pro board layout (see scripts/prepare-showcase-models.mjs and
 * public/showcase/README.md for provenance), lit like a studio product shot.
 *
 * Scroll progress drives one continuous choreography:
 *   1  meet it        assembled, floating, slow turn
 *   2  see the air    streamlines appear, the cube turns its sensor side to you
 *   3  understand     green / yellow / red demo states
 *   4  inside         exploded view with labels
 *   5  reassembly     everything returns to the hero framing
 * Everything is reversible: the same progress value always produces the same
 * pose, with a short damped follower so scrubbing feels weighted, not snappy.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { createAirflow } from './airflow.js';

export const STATES = {
  good: {
    led: 0x45e08c, css: '#22a06b', label: 'Your air is clear',
    air: { density: 0.22, speed: 1, turb: 0.12, size: 0.95, ambient: 0.05, color: 0x8ccbaa, opacity: 0.5 },
  },
  moderate: {
    led: 0xffc23a, css: '#d99a1a', label: 'Time for fresh air',
    air: { density: 0.55, speed: 1.2, turb: 0.5, size: 1.1, ambient: 0.55, color: 0xd9ad4f, opacity: 0.6 },
  },
  poor: {
    led: 0xff5546, css: '#e0523f', label: 'Air quality needs attention',
    air: { density: 0.85, speed: 1.45, turb: 1, size: 1.2, ambient: 1, color: 0xe3806f, opacity: 0.68 },
  },
};

/* Printed parts: explode offsets in mm (device frame, Y up) and label copy.
 * Descriptions follow the project's assembly guide. */
export const PARTS = {
  top: { offset: [0, 38, 0], title: 'Diffused top', text: 'Translucent printed shell. Three RGB LEDs under it light the whole top, so the verdict reads from across the room.' },
  lightWall: { offset: [0, 20, 0], title: 'Light wall', text: 'Printed insert that shapes the LED glow (Pro).' },
  airWall: { offset: [0, 13, 0], title: 'Air wall', text: 'Printed wall that separates the sensors from the rest of the cube, so they sample air from the side openings rather than warm air from the electronics.' },
  button: { offset: [0, 3, 13], title: 'Button cap', text: 'Printed cap over the side switch: brightness presets, and hold for Zigbee pairing (Pro).' },
  pcb: { offset: [0, 0, 0], title: 'Main board', text: '45 × 45 mm PCB carrying the radio module, sensors, LEDs and USB-C.' },
  bottom: { offset: [0, -18, 0], title: 'Bottom housing', text: 'Printed tray with the USB-C opening, side air slots and three screw bosses that hold the board.' },
};

/* Board components worth a label, by KiCad reference on the Pro board. */
export const COMPONENTS = {
  U7: { title: 'ESP32-H2-MINI-1', text: 'RISC-V microcontroller module with Zigbee, Thread and Bluetooth LE. No Wi-Fi by design.' },
  U3: { title: 'SCD41', text: 'Sensirion NDIR sensor for true CO₂ (Pro). Shown as a datasheet-sized box; the real part has a white membrane on top.', approx: true },
  U2: { title: 'ENS161', text: 'ScioSense metal-oxide gas sensor: VOCs, with eCO₂ and TVOC estimates.' },
  U10: { title: 'ENS210', text: 'ScioSense temperature and humidity sensor.' },
  U1: { title: 'VCNL4040', text: 'Vishay ambient light sensor behind the light wall; dims the glow at night (Pro). Illustrative body.', approx: true },
  P1: { title: 'USB-C', text: 'GCT USB4105 receptacle. 5 V in, and serial readings out.' },
  LED2: { title: 'RGB LEDs', text: 'Three IN-PI15TAT5R5G5B addressable LEDs: the only light source for the top.' },
  S3: { title: 'Side switch', text: 'E-Switch TL1016 right-angle tactile switch, pressed through the button cap.' },
};

const DEVICE_SCALE = 0.1; // GLB is in mm; the scene works in cm
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerp = (a, b, t) => a + (b - a) * t;
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

function radialTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Emissive falls off up the cap, like light from LEDs at its base diffusing upward. */
function glowGradient(material) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vCapY;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCapY = position.y;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vCapY;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n// positions are quantised: 0.01 mm units\ntotalEmissiveRadiance *= 0.72 + 0.28 * (1.0 - smoothstep(300.0, 2900.0, vCapY));');
  };
}

export async function createShowcase(canvas, { reducedMotion = false, lowPower = false, onLabels, onPick, onHover } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  const pixelRatio = Math.min(window.devicePixelRatio || 1, lowPower ? 1.5 : 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.75;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(26, 1, 0.5, 300);

  // Rig: rotation (auto + drag + parallax) and the floating bob. Device inside
  // it is the mm-scale model; particles live in the rig in cm.
  const rig = new THREE.Group();
  scene.add(rig);
  const device = new THREE.Group();
  device.scale.setScalar(DEVICE_SCALE);
  rig.add(device);

  const air = createAirflow({ count: lowPower ? 2600 : 7000, pixelRatio });
  rig.add(air.points);

  // Studio lighting: soft environment, one shadowing key, a cool fill, and the
  // LED light itself so the glow lands on the tray and the surface below.
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(4.5, 11, 6.5);
  key.castShadow = true;
  key.shadow.mapSize.set(lowPower ? 1024 : 2048, lowPower ? 1024 : 2048);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 40;
  key.shadow.camera.left = key.shadow.camera.bottom = -8;
  key.shadow.camera.right = key.shadow.camera.top = 8;
  key.shadow.radius = 9;
  key.shadow.blurSamples = 16;
  key.shadow.bias = -0.0002;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xdfe7f5, 0.7);
  fill.position.set(-7, 5, -5);
  scene.add(fill);
  const ledLight = new THREE.PointLight(0xffffff, 0, 14, 2);
  ledLight.position.set(0, 1.6, 0);
  rig.add(ledLight);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.ShadowMaterial({ opacity: 0.11 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.34;
  ground.receiveShadow = true;
  scene.add(ground);
  const glowDisc = new THREE.Mesh(
    new THREE.CircleGeometry(6, 48),
    new THREE.MeshBasicMaterial({ map: radialTexture(), transparent: true, opacity: 0, depthWrite: false, color: 0xffffff }),
  );
  glowDisc.rotation.x = -Math.PI / 2;
  glowDisc.position.y = -0.33;
  scene.add(glowDisc);

  // ------------------------------------------------------------- materials
  const topMat = lowPower
    ? new THREE.MeshStandardMaterial({ color: 0xe6e4df, roughness: 0.6, transparent: true, opacity: 0.96, emissive: 0x000000 })
    : new THREE.MeshPhysicalMaterial({
      // Diffused PLA: mostly opaque, a little light bleeds through, matte surface.
      color: 0xdedcd7, roughness: 0.66, metalness: 0,
      transmission: 0.28, thickness: 3, ior: 1.45,
      attenuationColor: new THREE.Color(0xf6f4ef), attenuationDistance: 4,
      specularIntensity: 0.35, emissive: 0x000000,
    });
  glowGradient(topMat);
  const trayMat = new THREE.MeshStandardMaterial({ color: 0xd9d8d4, roughness: 0.62, metalness: 0 });
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xe6e4df, roughness: 0.65, metalness: 0 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x4a4a4c, roughness: 0.6, metalness: 0 });
  const buttonMat = new THREE.MeshStandardMaterial({ color: 0x7a7a7c, roughness: 0.55, metalness: 0 });
  const pcbMat = new THREE.MeshStandardMaterial({ color: 0x9fc9ad, vertexColors: true, roughness: 0.55, metalness: 0.05 });
  const compMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.15 });
  const ledMat = new THREE.MeshStandardMaterial({ color: 0xfafafa, emissive: 0xffffff, emissiveIntensity: 5, roughness: 0.4 });
  const materialFor = (name) => {
    if (name === 'top') return topMat;
    if (name === 'bottom') return trayMat;
    if (name === 'airWall') return wallMat;
    if (name === 'lightWall') return darkMat;
    if (name === 'button') return buttonMat;
    if (name === 'pcb') return pcbMat;
    if (/^LED\d/.test(name)) return ledMat;
    return compMat;
  };

  // ------------------------------------------------------------------ model
  const groups = {};
  for (const name of Object.keys(PARTS)) {
    groups[name] = new THREE.Group();
    groups[name].name = name;
    device.add(groups[name]);
  }
  const gltf = await new GLTFLoader().loadAsync('/showcase/noware.glb');
  const meshes = [];
  gltf.scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
  const anchors = new Map(); // label name -> local centre in device mm
  const labelMeshes = new Map();
  const box = new THREE.Box3();
  for (const mesh of meshes) {
    const name = mesh.name;
    const part = PARTS[name] ? name : 'pcb';
    mesh.material = materialFor(name);
    mesh.castShadow = name !== 'top';
    mesh.receiveShadow = name === 'pcb' || name === 'bottom';
    mesh.userData.part = part;
    mesh.userData.label = PARTS[name] ? name : COMPONENTS[name] ? name : null;
    groups[part].add(mesh);
    if (mesh.userData.label) {
      mesh.geometry.computeBoundingBox();
      mesh.updateMatrix();
      box.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrix);
      const c = box.getCenter(new THREE.Vector3());
      // Anchor at the top face of the part so leader lines land on something visible.
      c.y = box.max.y;
      if (name === 'bottom') c.y = box.min.y + 2;
      if (name === 'top') c.y = box.max.y - 6;
      anchors.set(mesh.userData.label, c);
      labelMeshes.set(mesh.userData.label, mesh);
    }
  }
  // Transmission needs the scene behind the top rendered first; three handles
  // that, but the top should still draw after the particles inside it.
  for (const m of groups.top.children) m.renderOrder = 3;

  const highlightMat = compMat.clone();
  highlightMat.emissive = new THREE.Color(0x2563eb);
  highlightMat.emissiveIntensity = 0.35;

  // --------------------------------------------------------------- animation
  const state = {
    progress: 0, progressTarget: 0,
    autoRot: 0.6, drag: 0, dragVel: 0,
    pointer: new THREE.Vector2(), parallax: new THREE.Vector2(),
    color: new THREE.Color(STATES.good.led), colorTarget: new THREE.Color(STATES.good.led),
    hover: null, highlighted: null,
    visible: true, dragging: false,
  };
  air.setParams(STATES.good.air);

  function setHighlight(name) {
    if (state.highlighted === name) return;
    if (state.highlighted) {
      const mesh = labelMeshes.get(state.highlighted);
      if (mesh) mesh.material = materialFor(mesh.name);
    }
    state.highlighted = name;
    const mesh = name ? labelMeshes.get(name) : null;
    if (mesh && !PARTS[mesh.name] && !/^LED\d/.test(mesh.name)) {
      mesh.material = highlightMat;
    } else if (mesh) {
      const m = materialFor(mesh.name).clone();
      m.emissive = new THREE.Color(0x2563eb);
      m.emissiveIntensity = mesh.name === 'top' ? 0.12 : 0.25;
      if (mesh.name === 'top') glowGradient(m);
      mesh.material = m;
    }
  }

  // Pointer: parallax from anywhere, drag on the canvas, hover picking when exploded.
  const raycaster = new THREE.Raycaster();
  let lastPointerClient = null;
  let pointerDownAt = null;
  canvas.addEventListener('pointerdown', (e) => {
    state.dragging = true;
    state.dragVel = 0;
    pointerDownAt = { x: e.clientX, y: e.clientY, t: performance.now() };
    lastPointerClient = { x: e.clientX, y: e.clientY };
    canvas.classList.add('dragging');
    canvas.setPointerCapture?.(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (state.dragging && lastPointerClient) {
      const dx = e.clientX - lastPointerClient.x;
      state.drag += dx * 0.008;
      state.dragVel = dx * 0.008;
      lastPointerClient = { x: e.clientX, y: e.clientY };
    }
    const rect = canvas.getBoundingClientRect();
    state.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    state.pointerDirty = true;
  });
  const endDrag = (e) => {
    if (!state.dragging) return;
    state.dragging = false;
    canvas.classList.remove('dragging');
    // A short, still press counts as a click on whatever is under it.
    if (pointerDownAt && Math.hypot(e.clientX - pointerDownAt.x, e.clientY - pointerDownAt.y) < 6 && performance.now() - pointerDownAt.t < 400) {
      pick(true);
    }
    pointerDownAt = null;
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', () => { if (!state.dragging) { state.hover = null; } });
  window.addEventListener('pointermove', (e) => {
    state.parallax.set((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
  }, { passive: true });

  let pickable = [];
  function pick(click = false) {
    if (!pickable.length) return;
    raycaster.setFromCamera(state.pointer, camera);
    const hit = raycaster.intersectObjects(pickable, false)[0];
    const name = hit ? hit.object.userData.label : null;
    if (click) {
      onPick?.(name);
    } else if (name !== state.hover) {
      state.hover = name;
      onHover?.(name);
    }
  }

  // --------------------------------------------------------------- per frame
  const target = new THREE.Vector3();
  const camPos = new THREE.Vector3();
  const anchorWorld = new THREE.Vector3();
  const labelOut = [];
  const timer = new THREE.Timer();
  let time = 0;
  let labelVis = 0;
  let explodeVis = 0;

  function frame() {
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.05);
    time += dt;
    if (!state.visible) return;

    // Progress follower: weighted but never laggy enough to feel broken.
    const follow = reducedMotion ? 1 : 1 - Math.exp(-dt * 7);
    state.progress += (state.progressTarget - state.progress) * follow;
    const p = state.progress;

    // Scene weights derived from one progress value, so scrubbing back exactly reverses.
    const airVis = smooth(0.14, 0.27, p) * (1 - smooth(0.6, 0.7, p));
    const sensorFace = smooth(0.14, 0.3, p) * (1 - smooth(0.52, 0.64, p));
    const explode = easeInOut(smooth(0.6, 0.8, p) * (1 - smooth(0.85, 0.985, p)));
    labelVis = smooth(0.7, 0.76, p) * (1 - smooth(0.84, 0.88, p));
    explodeVis = explode;

    // Rotation: slow turn, user drag with inertia, pointer parallax, and a pull
    // toward the sensor side while the airflow scene is up.
    if (!reducedMotion && !state.dragging) state.autoRot += dt * 0.11;
    if (!state.dragging) {
      state.drag += state.dragVel;
      state.dragVel *= Math.pow(0.02, dt);
    }
    const parallaxX = reducedMotion ? 0 : state.parallax.x * 0.22;
    const parallaxY = reducedMotion ? 0 : state.parallax.y * 0.05;
    let rotY = state.autoRot + state.drag + parallaxX;
    const faceTarget = Math.PI + 0.45; // -z face (air slots and sensors) toward the camera, three-quarter
    rotY += wrapAngle(faceTarget - rotY) * sensorFace * 0.9;
    rig.rotation.y = rotY;
    rig.rotation.x = parallaxY;
    rig.position.y = 0.6 + (reducedMotion ? 0 : Math.sin(time * 0.9) * 0.12) - explode * 0.3;

    // Exploded offsets (mm, in the device group).
    for (const [name, part] of Object.entries(PARTS)) {
      groups[name].position.set(part.offset[0] * explode, part.offset[1] * explode, part.offset[2] * explode);
    }

    // Camera: hero framing, a lower look for the air scene, higher and farther for the exploded view.
    const low = sensorFace;
    const polar = lerp(lerp(1.22, 1.34, low), 1.05, explode);
    const dist = lerp(lerp(27, 25, low), 46, explode);
    const narrow = camera.aspect < 0.9, mid = camera.aspect < 1.3;
    const aspectBoost = narrow ? 1.5 : mid ? 1.2 : 1;
    // Desktop copy sits on the left, so the cube lives in the right 60%.
    target.set(narrow ? 0 : mid ? -1.6 : lerp(-2.6, -3.6, explode), lerp(1.3, 2.4, explode) + (narrow ? 2.6 : 0), 0);
    camPos.set(Math.sin(polar) * 0.18, Math.cos(polar), Math.sin(polar)).multiplyScalar(dist * aspectBoost).add(target);
    if (!state.cameraReady) { camera.position.copy(camPos); state.cameraReady = true; }
    camera.position.lerp(camPos, reducedMotion ? 1 : 1 - Math.exp(-dt * 5));
    camera.lookAt(target);

    // LED colour, the glow it throws, and the air to match.
    state.color.lerp(state.colorTarget, 1 - Math.exp(-dt * 3));
    const glow = 1 - explode * 0.35;
    topMat.emissive.copy(state.color);
    topMat.emissiveIntensity = 1.15 * glow;
    ledMat.emissive.copy(state.color);
    ledLight.color.copy(state.color);
    ledLight.intensity = 20 * glow;
    ledLight.position.y = 1.6 + (groups.top.position.y * DEVICE_SCALE) * 0.5;
    glowDisc.material.color.copy(state.color);
    glowDisc.material.opacity = 0.3 * glow;
    air.setVisibility(airVis);
    air.update(time, dt);

    // Labels: project anchors for the page to place DOM labels and leader lines.
    if (onLabels && (labelVis > 0 || labelOut.length)) {
      labelOut.length = 0;
      if (labelVis > 0) {
        const w = canvas.clientWidth, h = canvas.clientHeight;
        for (const [name, local] of anchors) {
          const mesh = labelMeshes.get(name);
          anchorWorld.copy(local).add(groups[mesh.userData.part].position);
          device.localToWorld(anchorWorld);
          const depth = anchorWorld.clone().project(camera);
          labelOut.push({ name, x: (depth.x + 1) / 2 * w, y: (1 - depth.y) / 2 * h, z: depth.z, part: mesh.userData.part, approx: Boolean(COMPONENTS[name]?.approx) });
        }
      }
      const centre = device.getWorldPosition(anchorWorld).project(camera);
      onLabels(labelOut, labelVis, { x: (centre.x + 1) / 2 * canvas.clientWidth });
    }

    // Hover picking only when the parts are apart enough to tell them apart.
    pickable = explode > 0.5 ? [...labelMeshes.values()] : [];
    canvas.classList.toggle('interactive', true);
    if (state.pointerDirty && !state.dragging) {
      state.pointerDirty = false;
      if (pickable.length) pick(false);
      else if (state.hover) { state.hover = null; onHover?.(null); }
    }

    renderer.render(scene, camera);
  }
  renderer.setAnimationLoop(frame);

  function resize() {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  return {
    setProgress(p) { state.progressTarget = Math.min(1, Math.max(0, p)); },
    setState(name) {
      const s = STATES[name] || STATES.good;
      state.colorTarget.set(s.led);
      air.setParams(s.air);
    },
    setHover(name) { setHighlight(name); },
    setVisible(v) {
      state.visible = v;
      if (v) timer.reset?.();
    },
    get exploded() { return explodeVis; },
    dispose() {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      air.dispose();
      renderer.dispose();
    },
  };
}
