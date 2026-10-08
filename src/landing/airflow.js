/* Airflow illustration for the homepage showcase.
 *
 * Thousands of GPU points, each following a cubic Bézier streamline computed
 * in the vertex shader from four control points. Three lanes:
 *   0 "through": approaches the sensor side, enters a side slot, lingers in the
 *     sensing chamber behind the air wall, then drifts back out or on through.
 *   1 "around":  passes beside or over the cube.
 *   2 "ambient": slow drifting motes near the cube; mostly visible in the
 *     moderate and poor states, standing in for airborne particles.
 * noware has no fan, so everything moves slowly and nothing is blown out.
 *
 * Coordinates are centimetres in the device frame (Y up, origin at the board
 * underside centre; the cube spans ±2.45 in x/z and -0.3..2.9 in y). The side
 * air slots sit low on the -z face near the corners; the sensors are behind
 * the air wall at z ≈ -1 .. -2.1.
 */

import * as THREE from 'three';

const VERT = /* glsl */ `
  uniform float uTime, uSpeed, uTurb, uSize, uPixelRatio, uAmbient;
  attribute vec3 aStart, aC1, aC2, aEnd;
  attribute vec4 aSeed; // phase, speed, size, lane
  varying float vAlpha, vInside;

  vec3 bez(vec3 a, vec3 b, vec3 c, vec3 d, float t) {
    float s = 1.0 - t;
    return s*s*s*a + 3.0*s*s*t*b + 3.0*s*t*t*c + t*t*t*d;
  }

  void main() {
    float lane = aSeed.w;
    float seed = aSeed.x;
    vec3 p;
    float alpha;
    vInside = 0.0;
    if (lane < 1.5) {
      float u = fract(seed + uTime * 0.04 * aSeed.y * uSpeed);
      p = bez(aStart, aC1, aC2, aEnd, u);
      // Gentle meander so the streamlines read as air, not rails.
      vec3 wob = vec3(
        sin(p.y * 1.7 + uTime * 0.9 + seed * 6.3),
        sin(p.z * 1.3 - uTime * 0.7 + seed * 12.6),
        sin(p.x * 1.9 + uTime * 1.1 + seed * 18.9));
      p += wob * (0.06 + 0.3 * uTurb);
      alpha = smoothstep(0.0, 0.1, u) * (1.0 - smoothstep(0.86, 1.0, u));
      if (lane < 0.5) {
        vInside = smoothstep(0.36, 0.48, u) * (1.0 - smoothstep(0.58, 0.72, u));
      }
    } else {
      float t = uTime * 0.07 * aSeed.y * uSpeed;
      p = aStart + vec3(sin(t + seed * 6.28), sin(t * 0.8 + seed * 3.0), cos(t * 1.1 + seed * 9.0)) * (0.35 + 1.1 * uTurb);
      alpha = uAmbient * (0.55 + 0.45 * sin(uTime * 1.3 + seed * 20.0));
    }
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float size = (2.4 + 1.2 * vInside) * aSeed.z * uSize * uPixelRatio;
    gl_PointSize = size * (26.0 / -mv.z);
    vAlpha = alpha;
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vAlpha, vInside;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float disc = smoothstep(0.5, 0.1, d);
    // Inside the sensing chamber the motes lift toward white: a haze seen through the cap, not specks on it.
    vec3 col = mix(uColor, vec3(1.0), vInside * 0.55);
    gl_FragColor = vec4(col, disc * vAlpha * uOpacity * (0.6 + 0.3 * vInside));
  }
`;

const rand = (a, b) => a + Math.random() * (b - a);
const sign = () => (Math.random() < 0.5 ? -1 : 1);

export function createAirflow({ count = 7000, pixelRatio = 1 } = {}) {
  const start = new Float32Array(count * 3);
  const c1 = new Float32Array(count * 3);
  const c2 = new Float32Array(count * 3);
  const end = new Float32Array(count * 3);
  const seed = new Float32Array(count * 4);
  const put = (arr, i, x, y, z) => { arr[i * 3] = x; arr[i * 3 + 1] = y; arr[i * 3 + 2] = z; };

  for (let i = 0; i < count; i++) {
    // Lanes are interleaved so a draw-range prefix keeps the same mix.
    const slot = i % 10;
    const lane = slot < 2 ? 0 : slot < 7 ? 1 : 2;
    if (lane === 0) {
      const side = sign();
      const y = rand(0.25, 0.95);
      put(start, i, side * rand(0.5, 3.5) + rand(-1, 1), rand(0.2, 3.4), rand(-14, -8));
      put(c1, i, side * rand(1.6, 2.2), y, -2.9);
      put(c2, i, rand(-1.6, 1.6), rand(0.4, 1.3), -1.5);
      if (Math.random() < 0.6) {
        // Linger, then drift back out of the same side and upward.
        put(end, i, side * rand(1, 5), rand(2.5, 6), rand(-7, -12));
      } else {
        // Carry on through to the slots on the far side.
        put(end, i, rand(-3, 3), rand(0.5, 4), rand(8, 14));
      }
    } else if (lane === 1) {
      const side = sign();
      const y = rand(0.2, 4.4);
      const overTop = Math.random() < 0.25;
      put(start, i, side * rand(2.4, 5.5) + rand(-1, 1), y, rand(-14, -10));
      if (overTop) {
        const x = rand(-2.2, 2.2);
        put(c1, i, x, rand(3.9, 5.2), -2.5);
        put(c2, i, x + rand(-0.5, 0.5), rand(4.1, 5.6), 2.5);
      } else {
        put(c1, i, side * rand(3.2, 4.3), y, -2.5);
        put(c2, i, side * rand(3.2, 4.6), y + rand(0, 1.4), 2.5);
      }
      put(end, i, side * rand(2.5, 6.5), y + rand(0, 2.2), rand(9, 15));
    } else {
      let x, y, z;
      do {
        x = rand(-7, 7); y = rand(-0.1, 6.5); z = rand(-7, 7);
      } while (Math.abs(x) < 3 && Math.abs(z) < 3 && y < 3.6);
      put(start, i, x, y, z);
    }
    seed[i * 4] = Math.random();
    seed[i * 4 + 1] = rand(0.6, 1.4);
    seed[i * 4 + 2] = rand(0.6, 1.4);
    seed[i * 4 + 3] = lane;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(start, 3)); // required by three; the shader uses aStart
  geometry.setAttribute('aStart', new THREE.BufferAttribute(start, 3));
  geometry.setAttribute('aC1', new THREE.BufferAttribute(c1, 3));
  geometry.setAttribute('aC2', new THREE.BufferAttribute(c2, 3));
  geometry.setAttribute('aEnd', new THREE.BufferAttribute(end, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 2, 0), 20);

  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uSpeed: { value: 1 },
      uTurb: { value: 0.2 },
      uSize: { value: 1 },
      uAmbient: { value: 0.15 },
      uOpacity: { value: 0 },
      uColor: { value: new THREE.Color(0x7cc9a0) },
      uPixelRatio: { value: pixelRatio },
    },
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 2;

  const target = { density: 0.35, speed: 1, turb: 0.2, size: 1, ambient: 0.15, opacity: 0, color: new THREE.Color(0x7cc9a0) };
  const current = { ...target, color: target.color.clone() };
  let visibility = 0;

  return {
    points,
    /** Air parameters for a state; eased toward over the next second or so. */
    setParams(params) {
      Object.assign(target, params, params.color != null ? { color: new THREE.Color(params.color) } : {});
    },
    /** 0..1 overall visibility, driven by scroll. */
    setVisibility(v) {
      visibility = v;
    },
    update(time, dt) {
      const k = 1 - Math.exp(-dt * 2.5);
      for (const key of ['density', 'speed', 'turb', 'size', 'ambient', 'opacity']) {
        current[key] += (target[key] - current[key]) * k;
      }
      current.color.lerp(target.color, k);
      const u = material.uniforms;
      u.uTime.value = time;
      u.uSpeed.value = current.speed;
      u.uTurb.value = current.turb;
      u.uSize.value = current.size;
      u.uAmbient.value = current.ambient;
      u.uOpacity.value = current.opacity * visibility;
      u.uColor.value.copy(current.color);
      geometry.setDrawRange(0, Math.max(0, Math.floor(count * current.density)));
      points.visible = u.uOpacity.value > 0.005;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
