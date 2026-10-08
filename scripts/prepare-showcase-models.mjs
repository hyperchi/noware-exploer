// Builds public/showcase/noware.glb for the homepage 3D showcase.
//
// Usage: node scripts/prepare-showcase-models.mjs
//
// Sources (all in ../aircube-source, the hyperchi/AirCube clone):
// - mechanical/pro/STEP/*.step: the five printed enclosure parts, already in
//   one assembly frame (49 x 49 mm footprint).
// - kicad/Base/AirCube.step: the bare PCB body (same 45 x 45 outline as Pro).
// - kicad/Pro/AirCube.kicad_pcb: Pro component placements.
// Component bodies come from public/models/*.json (see public/models/README.md
// for each one's provenance). SCD41 and VCNL4040 have no CAD there and are
// built as datasheet-sized boxes, flagged `approximate` in the node extras.
//
// Output frame: millimetres, Y up, origin at the enclosure's footprint centre
// on the PCB's underside. Every node carries vertex colours; the page assigns
// real materials at runtime.
import fs from 'node:fs';
import path from 'node:path';
import occtImport from 'occt-import-js';

const SRC = path.resolve('../aircube-source');
const OUT = 'public/showcase/noware.glb';
const ENCLOSURE_CENTER = [46.5, -58.5]; // STEP frame x, y
const BOARD_SHIFT_Y = 5; // KiCad board frame -> enclosure frame
const PCB_THICKNESS = 1.6;
const DEFLECTION = 0.02;

const occt = await occtImport();

function readStep(file) {
  const result = occt.ReadStepFile(fs.readFileSync(file), { linearUnit: 'millimeter', linearDeflection: DEFLECTION });
  if (!result.success) throw new Error(`Cannot read ${file}`);
  return result;
}

// ------------------------------------------------------------- geometry utils

/** Merge occt meshes into one {positions, normals, colors, indices}, colouring by mesh colour. */
function mergeOcct(meshes, fallback = [0.8, 0.8, 0.8]) {
  const parts = meshes.map((m) => ({
    positions: Array.from(m.attributes.position.array),
    normals: m.attributes.normal ? Array.from(m.attributes.normal.array) : null,
    indices: Array.from(m.index.array),
    color: m.color || fallback,
    faces: m.brep_faces || [],
  }));
  return mergeParts(parts);
}

function mergeParts(parts) {
  const positions = [], normals = [], colors = [], indices = [];
  let offset = 0;
  for (const p of parts) {
    const n = p.positions.length / 3;
    positions.push(...p.positions);
    normals.push(...(p.normals || computeNormals(p.positions, p.indices)));
    // Per-face colours override the mesh colour where the CAD provides them.
    const vertexColor = new Array(n).fill(p.color);
    for (const f of p.faces || []) {
      if (!f.color) continue;
      for (let t = f.first; t <= f.last; t++) {
        for (let k = 0; k < 3; k++) vertexColor[p.indices[t * 3 + k]] = f.color;
      }
    }
    for (const c of vertexColor) colors.push(c[0], c[1], c[2]);
    for (const i of p.indices) indices.push(i + offset);
    offset += n;
  }
  return { positions, normals, colors, indices };
}

function computeNormals(positions, indices) {
  const normals = new Array(positions.length).fill(0);
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]].map((i) => i * 3);
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const i of [a, b, c]) { normals[i] += nx; normals[i + 1] += ny; normals[i + 2] += nz; }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const l = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= l; normals[i + 1] /= l; normals[i + 2] /= l;
  }
  return normals;
}

/** Apply a transform to positions/normals in place. STEP (Z up) -> output (Y up). */
function toOutputFrame(geom, { translate = [0, 0, 0], rotateZDeg = 0, scale = 1 } = {}) {
  const r = (rotateZDeg * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
  const { positions: p, normals: n } = geom;
  for (let i = 0; i < p.length; i += 3) {
    let x = p[i] * scale, y = p[i + 1] * scale, z = p[i + 2] * scale;
    [x, y] = [x * cos - y * sin, x * sin + y * cos];
    x += translate[0]; y += translate[1]; z += translate[2];
    // STEP (x, y, z up) -> glTF (x, z up -> y, -y -> z)
    p[i] = x - ENCLOSURE_CENTER[0]; p[i + 1] = z; p[i + 2] = -(y - ENCLOSURE_CENTER[1]);
    let nx = n[i], ny = n[i + 1], nz = n[i + 2];
    [nx, ny] = [nx * cos - ny * sin, nx * sin + ny * cos];
    n[i] = nx; n[i + 1] = nz; n[i + 2] = -ny;
  }
  return geom;
}

function box(w, d, h, color) {
  // w along x, d along y (STEP frame), h along z, sitting on z=0.
  const hx = w / 2, hy = d / 2;
  const faces = [
    [[-hx, -hy, 0], [hx, -hy, 0], [hx, hy, 0], [-hx, hy, 0], [0, 0, -1]],
    [[-hx, -hy, h], [-hx, hy, h], [hx, hy, h], [hx, -hy, h], [0, 0, 1]],
    [[-hx, -hy, 0], [-hx, -hy, h], [hx, -hy, h], [hx, -hy, 0], [0, -1, 0]],
    [[hx, hy, 0], [hx, hy, h], [-hx, hy, h], [-hx, hy, 0], [0, 1, 0]],
    [[hx, -hy, 0], [hx, -hy, h], [hx, hy, h], [hx, hy, 0], [1, 0, 0]],
    [[-hx, hy, 0], [-hx, hy, h], [-hx, -hy, h], [-hx, -hy, 0], [-1, 0, 0]],
  ];
  const positions = [], normals = [], indices = [];
  faces.forEach(([a, b, c, d, nrm], f) => {
    positions.push(...a, ...b, ...c, ...d);
    for (let k = 0; k < 4; k++) normals.push(...nrm);
    indices.push(f * 4, f * 4 + 1, f * 4 + 2, f * 4, f * 4 + 2, f * 4 + 3);
  });
  return { positions, normals, indices, color };
}

// ----------------------------------------------------------------- enclosure

const nodes = [];
const enclosureDir = path.join(SRC, 'mechanical/pro/STEP');
const enclosure = {
  top: 'AirCube_top-8-31-26.step',
  bottom: 'AirCube bottom_prod_12-11.step',
  airWall: 'AirCube_air_wall_8-31-26.step',
  lightWall: 'AirCube_light_wall-8-31-26.step',
  button: 'AirCube_button-8-31-26.step',
};
for (const [name, file] of Object.entries(enclosure)) {
  const step = readStep(path.join(enclosureDir, file));
  const geom = toOutputFrame(mergeOcct(step.meshes, [0.9, 0.9, 0.88]));
  nodes.push({ name, geom, extras: { source: `mechanical/pro/STEP/${file}` } });
  console.log(name.padEnd(10), geom.indices.length / 3, 'tris');
}

// ----------------------------------------------------------------------- PCB

const board = readStep(path.join(SRC, 'kicad/Base/AirCube.step'));
let pcbMeshes = [];
(function walk(n) {
  if (n.name === 'AirCube_PCB') pcbMeshes = n.meshes.map((i) => board.meshes[i]);
  for (const c of n.children) walk(c);
})(board.root);
if (!pcbMeshes.length) throw new Error('AirCube_PCB not found in board STEP');
const pcb = toOutputFrame(mergeOcct(pcbMeshes, [0.1, 0.35, 0.22]), { translate: [0, BOARD_SHIFT_Y, 0] });
nodes.push({ name: 'pcb', geom: pcb, extras: { source: 'kicad/Base/AirCube.step (board body; Pro shares the 45 x 45 outline)' } });
console.log('pcb'.padEnd(10), pcb.indices.length / 3, 'tris');

// ---------------------------------------------------------------- components

const kicad = fs.readFileSync(path.join(SRC, 'kicad/Pro/AirCube.kicad_pcb'), 'utf8');
const placements = [];
for (const m of kicad.matchAll(/\(footprint "([^"]+)"/g)) {
  const chunk = kicad.slice(m.index, m.index + 3000);
  const at = chunk.match(/\(at ([-\d.]+) ([-\d.]+)(?: ([-\d.]+))?\)/);
  const ref = chunk.match(/\(property "Reference" "([^"]+)"/);
  const layer = chunk.match(/\(layer "([^"]+)"/);
  const value = chunk.match(/\(property "Value" "([^"]+)"/);
  if (!at || !ref || layer?.[1] !== 'F.Cu') continue;
  placements.push({ ref: ref[1], footprint: m[1], value: value?.[1] || '', x: +at[1], y: +at[2], rot: +(at[3] || 0) });
}

const MODELS = {
  'Resistor_SMD:R_0603_1608Metric': 'resistor-0603',
  'Capacitor_SMD:C_0603_1608Metric': 'capacitor-0603',
  'custom_IC:IN-PI15_INL': 'rgb-led',
  'Package_TO_SOT_SMD:SOT-23': 'sot23',
  'kicad_reformed_custom_IC:AP2204': 'sot23-5',
  'Diode_SMD:D_SOD-523': 'sod523',
  'kicad_reformed_custom_IC:MODULE_ESP32-H2-MINI-1-H2': 'esp32-h2-mini-1',
  'kicad_reformed_custom_IC:ENS210': 'ens210',
  'kicad_reformed_custom_IC:ENS161': 'ens161',
  'kicad_reformed_custom_IC:GCT_USB4105-GF-A': 'usb4105',
  'custom_IC:TL1016AAF220QG': 'tl1016',
};
// Datasheet nominal bodies for parts without CAD in public/models.
const BOXES = {
  'Sensor:Sensirion_SCD4x-1EP_10.1x10.1mm_P1.25mm_EP4.8x4.8mm': { size: [10.1, 10.1, 6.5], color: [0.16, 0.16, 0.17], note: 'SCD41 body from Sensirion datasheet nominal 10.1 x 10.1 x 6.5 mm; membrane and marking omitted' },
  'kicad_reformed_custom_IC:VISHAY_VCNL4040_4X2X1.1': { size: [4, 2, 1.1], color: [0.12, 0.12, 0.13], note: 'VCNL4040 body from Vishay nominal 4 x 2 x 1.1 mm; emitter/detector windows omitted' },
};
// Model-specific yaw so each CAD body matches its footprint's orientation.
const MODEL_YAW = { 'esp32-h2-mini-1': 0 };

const modelCache = new Map();
function loadModel(name) {
  if (!modelCache.has(name)) modelCache.set(name, JSON.parse(fs.readFileSync(`public/models/${name}.json`, 'utf8')));
  return modelCache.get(name);
}

let placed = 0, skipped = [];
for (const p of placements) {
  const stepX = p.x, stepY = -p.y + BOARD_SHIFT_Y; // KiCad y-down -> STEP y-up, then into the enclosure frame
  const modelName = MODELS[p.footprint];
  const boxSpec = BOXES[p.footprint];
  let geom, extras;
  if (modelName) {
    const model = loadModel(modelName);
    const parts = model.meshes.map((m) => ({
      positions: m.positions.slice(),
      normals: m.normals ? m.normals.slice() : null,
      indices: m.indices,
      color: m.color || [0.75, 0.75, 0.75],
      faces: m.faces,
    }));
    const merged = mergeParts(parts);
    // Models are centred on their bounding box; stand them on the board.
    const lift = model.dimensions[2] / 2;
    for (let i = 2; i < merged.positions.length; i += 3) merged.positions[i] += lift;
    geom = toOutputFrame(merged, { translate: [stepX, stepY, PCB_THICKNESS], rotateZDeg: p.rot + (MODEL_YAW[modelName] || 0) });
    extras = { ref: p.ref, value: p.value, model: modelName };
  } else if (boxSpec) {
    geom = toOutputFrame(mergeParts([box(...boxSpec.size, boxSpec.color)]), { translate: [stepX, stepY, PCB_THICKNESS], rotateZDeg: p.rot });
    extras = { ref: p.ref, value: p.value, approximate: true, note: boxSpec.note };
  } else {
    skipped.push(`${p.ref} (${p.footprint})`);
    continue;
  }
  nodes.push({ name: p.ref, geom, extras });
  placed++;
}
console.log('components placed', placed, '| skipped:', skipped.join(', ') || 'none');

// ----------------------------------------------------------------- GLB write

/** Merge vertices that share position, normal and colour (CAD output repeats them per face). */
function weld(g) {
  const map = new Map(), remap = new Uint32Array(g.positions.length / 3);
  const positions = [], normals = [], colors = [];
  const q = (v, s) => Math.round(v * s);
  for (let i = 0; i < remap.length; i++) {
    const key = `${q(g.positions[i * 3], 100)},${q(g.positions[i * 3 + 1], 100)},${q(g.positions[i * 3 + 2], 100)}|${q(g.normals[i * 3], 50)},${q(g.normals[i * 3 + 1], 50)},${q(g.normals[i * 3 + 2], 50)}|${q(g.colors[i * 3], 255)},${q(g.colors[i * 3 + 1], 255)},${q(g.colors[i * 3 + 2], 255)}`;
    let idx = map.get(key);
    if (idx === undefined) {
      idx = positions.length / 3;
      map.set(key, idx);
      positions.push(g.positions[i * 3], g.positions[i * 3 + 1], g.positions[i * 3 + 2]);
      normals.push(g.normals[i * 3], g.normals[i * 3 + 1], g.normals[i * 3 + 2]);
      colors.push(g.colors[i * 3], g.colors[i * 3 + 1], g.colors[i * 3 + 2]);
    }
    remap[i] = idx;
  }
  const indices = g.indices.map((i) => remap[i]);
  return { positions, normals, colors, indices };
}

function writeGlb(file, nodes) {
  const bin = [];
  let binLength = 0;
  const bufferViews = [], accessors = [], meshes = [], gltfNodes = [];
  function pushView(typed, target) {
    const pad = (4 - (binLength % 4)) % 4;
    if (pad) { bin.push(Buffer.alloc(pad)); binLength += pad; }
    const buf = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    bufferViews.push({ buffer: 0, byteOffset: binLength, byteLength: buf.byteLength, target });
    bin.push(buf); binLength += buf.byteLength;
    return bufferViews.length - 1;
  }
  function accessor(typed, type, componentType, target, withBounds = false, normalized = false) {
    const view = pushView(typed, target);
    const n = type === 'SCALAR' ? 1 : 3;
    const acc = { bufferView: view, componentType, count: typed.length / n, type };
    if (normalized) acc.normalized = true;
    if (withBounds) {
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < typed.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], typed[i + k]); max[k] = Math.max(max[k], typed[i + k]); }
      acc.min = min; acc.max = max;
    }
    accessors.push(acc);
    return accessors.length - 1;
  }
  // KHR_mesh_quantization: positions as 16-bit integers in 0.01 mm (node scale
  // restores millimetres), normals as signed bytes, colours as unsigned bytes.
  const POS_SCALE = 100;
  for (const node of nodes) {
    const g = weld(node.geom);
    const pos = accessor(Int16Array.from(g.positions, (v) => Math.round(v * POS_SCALE)), 'VEC3', 5122, 34962, true);
    const nrm = accessor(Int8Array.from(g.normals, (v) => Math.max(-127, Math.round(v * 127))), 'VEC3', 5120, 34962, false, true);
    const col = accessor(Uint8Array.from(g.colors, (v) => Math.round(Math.min(1, Math.max(0, v)) * 255)), 'VEC3', 5121, 34962, false, true);
    const many = g.positions.length / 3 > 65535;
    const idx = accessor(many ? Uint32Array.from(g.indices) : Uint16Array.from(g.indices), 'SCALAR', many ? 5125 : 5123, 34963);
    meshes.push({ name: node.name, primitives: [{ attributes: { POSITION: pos, NORMAL: nrm, COLOR_0: col }, indices: idx, material: 0 }] });
    gltfNodes.push({ name: node.name, mesh: meshes.length - 1, scale: [1 / POS_SCALE, 1 / POS_SCALE, 1 / POS_SCALE], extras: node.extras });
  }
  const json = {
    asset: { version: '2.0', generator: 'noware prepare-showcase-models' },
    extensionsUsed: ['KHR_mesh_quantization'],
    extensionsRequired: ['KHR_mesh_quantization'],
    scene: 0,
    scenes: [{ nodes: gltfNodes.map((_, i) => i) }],
    nodes: gltfNodes,
    meshes,
    materials: [{ name: 'vertex-colour', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.6 } }],
    accessors,
    bufferViews,
    buffers: [{ byteLength: binLength }],
  };
  let jsonBuf = Buffer.from(JSON.stringify(json));
  const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
  if (jsonPad) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]);
  const binBuf = Buffer.concat(bin);
  const binPad = (4 - (binBuf.length % 4)) % 4;
  const binChunk = binPad ? Buffer.concat([binBuf, Buffer.alloc(binPad)]) : binBuf;
  const header = Buffer.alloc(12);
  header.write('glTF', 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binChunk.length, 8);
  const jsonHeader = Buffer.alloc(8); jsonHeader.writeUInt32LE(jsonBuf.length, 0); jsonHeader.write('JSON', 4);
  const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(binChunk.length, 0); binHeader.writeUInt32LE(0x004e4942, 4);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([header, jsonHeader, jsonBuf, binHeader, binChunk]));
}

writeGlb(OUT, nodes);
const total = nodes.reduce((n, node) => n + node.geom.indices.length / 3, 0);
console.log(`wrote ${OUT}: ${nodes.length} nodes, ${total} triangles, ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);
