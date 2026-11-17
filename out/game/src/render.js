// The renderer and the sky: one WebGLRenderer, a sun that sweeps from noon to dusk, a
// three-stop sky dome with a sun disc and clouds, fog tinted to the horizon, and distant hills.
import * as THREE from 'three';
import { TIME_OF_DAY } from './config.js';
import { createRandom } from './rng.js';

const SKY_VERT = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const SKY_FRAG = /* glsl */`
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  uniform float uSunSize;
  uniform float uTime;
  uniform float uCloud;
  varying vec3 vDir;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0; float a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.07; a *= 0.5; }
    return v;
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = clamp(d.y, -1.0, 1.0);
    float t = pow(clamp(h, 0.0, 1.0), 0.42);
    vec3 col = mix(uHorizon, uTop, t);
    col = mix(col, uHorizon * 1.06, pow(1.0 - clamp(abs(h) * 3.4, 0.0, 1.0), 2.2) * 0.42);
    float sd = max(dot(d, normalize(uSunDir)), 0.0);
    float disc = smoothstep(1.0 - uSunSize, 1.0 - uSunSize * 0.35, sd);
    float glow = pow(sd, 6.0) * 0.55 + pow(sd, 60.0) * 0.9;
    col += uSunColor * (glow + disc * 6.0);
    float facing = pow(max(dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(uSunDir.x, 0.0, uSunDir.z))), 0.0), 2.0);
    col += uSunColor * facing * pow(1.0 - clamp(h * 1.6, 0.0, 1.0), 3.0) * 0.22;
    if (h > 0.0) {
      vec2 uv = d.xz / (h + 0.14) * 0.9 + vec2(uTime * 0.0035, uTime * 0.0012);
      float c = fbm(uv * 1.5);
      float band = smoothstep(0.52, 0.86, c) * smoothstep(0.02, 0.3, h) * (1.0 - smoothstep(0.55, 0.95, h));
      vec3 cloudCol = mix(vec3(0.98, 0.93, 0.88), uSunColor * 1.1, facing * 0.75);
      col = mix(col, cloudCol, band * uCloud);
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, powerPreference: 'high-performance', stencil: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.03;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}

export function createEnvironment(scene, seed = 7) {
  const sunDir = new THREE.Vector3(-0.86, 0.32, 0.38).normalize();
  const skyUniforms = {
    uTop: { value: new THREE.Color(0x3462a0) },
    uHorizon: { value: new THREE.Color(0xffc38a) },
    uSunColor: { value: new THREE.Color(0xffe0b0) },
    uSunDir: { value: sunDir.clone() },
    uSunSize: { value: 0.0075 },
    uTime: { value: 0 },
    uCloud: { value: 0.85 },
  };
  const skyMat = new THREE.ShaderMaterial({
    uniforms: skyUniforms, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
    side: THREE.BackSide, depthWrite: false, fog: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 20), skyMat);
  sky.frustumCulled = false;
  sky.renderOrder = -1000;
  scene.add(sky);

  const hemi = new THREE.HemisphereLight(0xbcd8f0, 0xbb9a72, 1.0);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffd2a0, 2.6);
  sun.position.copy(sunDir).multiplyScalar(240);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 5;
  sun.shadow.camera.far = 620;
  const S = 110;
  sun.shadow.camera.left = -S;
  sun.shadow.camera.right = S;
  sun.shadow.camera.top = S;
  sun.shadow.camera.bottom = -S;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.04;
  scene.add(sun);
  scene.add(sun.target);

  const fill = new THREE.DirectionalLight(0x8fb8e0, 0.4);
  fill.position.set(120, 90, -140);
  scene.add(fill);

  scene.fog = new THREE.Fog(0xf0bd92, 190, 820);

  const env = {
    sky, sun, hemi, fill, sunDir, skyUniforms,
    timeOfDay: 'golden',
    exposure: 1.03,
    setTimeOfDay(name) {
      const t = TIME_OF_DAY[name] ?? TIME_OF_DAY.golden;
      env.timeOfDay = name;
      sunDir.set(-0.86, Math.sin(t.elev) * 1.6, 0.38).normalize();
      skyUniforms.uSunDir.value.copy(sunDir);
      sun.position.copy(sunDir).multiplyScalar(240);
      sun.color.setHex(t.sun);
      sun.intensity = t.intensity;
      skyUniforms.uTop.value.setHex(t.sky);
      skyUniforms.uHorizon.value.setHex(t.horizon);
      skyUniforms.uSunColor.value.setHex(t.sun);
      hemi.color.setHex(t.sky).lerp(new THREE.Color(0xffffff), 0.5);
      hemi.intensity = t.ambient;
      scene.fog.color.setHex(t.fog);
      scene.fog.near = 170;
      scene.fog.far = 900;
      env.exposure = name === 'dusk' ? 1.12 : (name === 'noon' ? 0.98 : 1.04);
      skyUniforms.uCloud.value = name === 'noon' ? 0.7 : 0.9;
    },
    update(dt, focus) {
      skyUniforms.uTime.value += dt;
      sky.position.copy(focus);
      const snap = 2.0;
      sun.target.position.set(Math.round(focus.x / snap) * snap, 0, Math.round(focus.z / snap) * snap);
      sun.position.copy(sun.target.position).addScaledVector(sunDir, 240);
    },
  };
  return env;
}

/**
 * Distant terrain: three layered ridge silhouettes built as continuous jagged strips rather than
 * cones, hazed toward the horizon and drawn only on the landward side. A ridge is a wall of
 * triangles whose top edge follows a sum of sines, so it reads as a mountain range instead of a row
 * of pyramids. Fog is off and the colour is pre-hazed, so the layers stack in depth.
 */
export function createDistantHills(scene, seed = 21) {
  const rng = createRandom(seed);
  const group = new THREE.Group();
  const LAYERS = [
    { dist: 560, haze: 0.62, base: 46, amp: 34, tint: 0xb9a8a8 },
    { dist: 740, haze: 0.74, base: 66, amp: 44, tint: 0xcdb6ab },
    { dist: 940, haze: 0.86, base: 88, amp: 52, tint: 0xdfc3b2 },
  ];
  for (const layer of LAYERS) {
    const q = [rng.range(0, 6.3), rng.range(0, 6.3), rng.range(0, 6.3)];
    const N = 132;
    const positions = [];
    const colors = [];
    const base = new THREE.Color(layer.tint);
    const deep = new THREE.Color(0x6a6b78);
    const colTop = base.clone().lerp(new THREE.Color(0xf6d3b0), layer.haze);
    const colBot = deep.clone().lerp(new THREE.Color(0xc7a894), layer.haze * 0.9);
    const hAt = (a) => {
      const h = layer.base
        + Math.sin(a * 3.1 + q[0]) * layer.amp * 0.9
        + Math.sin(a * 7.3 + q[1]) * layer.amp * 0.45
        + Math.sin(a * 14.9 + q[2]) * layer.amp * 0.16;
      return Math.max(10, h);
    };
    // the landward arc: z <= 0 in this ring, i.e. sin(a) in [-1, 0]
    const a0 = Math.PI * 0.98;
    const a1 = Math.PI * 2.02;
    for (let i = 0; i < N; i += 1) {
      const ta = i / N, tb = (i + 1) / N;
      const aa = a0 + (a1 - a0) * ta;
      const ab = a0 + (a1 - a0) * tb;
      const ax = Math.cos(aa) * layer.dist, az = Math.sin(aa) * layer.dist;
      const bx = Math.cos(ab) * layer.dist, bz = Math.sin(ab) * layer.dist;
      const ha = hAt(aa), hb = hAt(ab);
      const yb = -50;
      // two triangles, wound to face the city in the middle of the map
      const quad = [
        [ax, yb, az, colBot], [bx, yb, bz, colBot], [bx, hb, bz, colTop],
        [ax, yb, az, colBot], [bx, hb, bz, colTop], [ax, ha, az, colTop],
      ];
      for (const [x, y, z, c] of quad) {
        positions.push(x, y, z);
        colors.push(c.r, c.g, c.b);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      vertexColors: true, fog: false, side: THREE.DoubleSide,
    }));
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    group.add(mesh);
  }
  group.name = 'hills';
  scene.add(group);
  return group;
}

export { SKY_FRAG, SKY_VERT };
