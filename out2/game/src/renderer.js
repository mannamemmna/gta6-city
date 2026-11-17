// A small WebGL renderer written for Cobalt Bay: one instanced draw for the static
// city, one for everything that moves, a gradient sky with a sun disc and fog.
// Geometry is a unit box (y from 0 to 1), a unit cylinder and a unit sphere, each
// stretched and tinted per instance.

import { identity, lookAt, multiply, perspective } from './math3d.js';
import { SKY, SUN } from './config.js';

const FLOATS_PER_INSTANCE = 11; // ox,oy,oz, sx,sy,sz, rot, r,g,b, material

const VS = `
attribute vec3 aPos;
attribute vec3 aNormal;
attribute vec3 iOffset;
attribute vec3 iScale;
attribute float iRot;
attribute vec4 iColor;
uniform mat4 uViewProj;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec4 vColor;
varying vec3 vLocal;
void main() {
  float c = cos(iRot);
  float s = sin(iRot);
  vec3 p = aPos * iScale;
  vec3 rp = vec3(p.x * c - p.z * s, p.y, p.x * s + p.z * c);
  vec3 w = rp + iOffset;
  vec3 n = aNormal;
  vNormal = vec3(n.x * c - n.z * s, n.y, n.x * s + n.z * c);
  vLocal = aPos;
  vWorld = w;
  vColor = iColor;
  gl_Position = uViewProj * vec4(w, 1.0);
}`;

const FS = `
precision mediump float;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uHaze;
uniform vec3 uCam;
uniform float uTime;
uniform float uFogEnd;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec4 vColor;
varying vec3 vLocal;

void main() {
  vec3 base = vColor.rgb;
  float mat = vColor.a;
  vec3 n = normalize(vNormal);
  vec3 toCam = uCam - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / max(dist, 0.001);

  vec3 col;
  if (mat > 0.5 && mat < 1.5) {
    // emissive: lit windows, lamps, headlights, neon
    col = base * (1.05 + 0.12 * sin(uTime * 1.7 + vWorld.x * 0.13 + vWorld.z * 0.09));
  } else if (mat > 1.5 && mat < 2.5) {
    // water: a perturbed normal so the sun lays a real glitter path across the
    // swell, plus a fresnel lift toward the horizon haze. Without the perturbed
    // normal the whole bay reads as one flat sheet, which is what a wide shot
    // punishes hardest.
    float ax = vWorld.x * 0.26 + uTime * 1.15;
    float az = vWorld.z * 0.31 - uTime * 0.95;
    float bx = vWorld.z * 0.19 - uTime * 0.70;
    float bz = vWorld.x * 0.23 + uTime * 0.85;
    vec3 N = normalize(vec3(
      0.085 * sin(ax) + 0.045 * sin(bx) + 0.022 * sin(vWorld.x * 0.9 + vWorld.z * 0.6 - uTime * 2.1),
      1.0,
      0.085 * sin(az) + 0.045 * sin(bz) + 0.022 * sin(vWorld.z * 0.8 - vWorld.x * 0.5 + uTime * 1.9)
    ));
    float lam = clamp(dot(N, normalize(uSunDir)) * 0.5 + 0.5, 0.0, 1.0);
    vec3 deep = vec3(0.026, 0.132, 0.196);
    vec3 shallow = vec3(0.058, 0.300, 0.352);
    col = mix(deep, shallow, lam * 0.75 + 0.16 * sin(vWorld.x * 0.05 + vWorld.z * 0.04));
    // sun glitter, laid down as a band along the sun's azimuth on the water's
    // plane rather than a narrow Phong highlight: at a wide shot's distances a
    // pure specular lobe never survives the wave noise and the bay reads dead
    vec3 sunFlat = normalize(vec3(uSunDir.x, 0.0, uSunDir.z) + vec3(0.0, 0.0, 0.0001));
    vec2 toFrag = vec2(vWorld.x - uCam.x, vWorld.z - uCam.z);
    float along = dot(toFrag, vec2(sunFlat.x, sunFlat.z));
    float across = abs(toFrag.x * -sunFlat.z + toFrag.y * sunFlat.x);
    float width = 14.0 + max(0.0, along) * 0.10;
    // GLSL smoothstep is undefined when its edges are reversed, so widen from
    // the centre out and invert: this is why the first attempt drew nothing.
    float band = (1.0 - smoothstep(width * 0.10, width, across)) * smoothstep(-30.0, 60.0, along);
    float chop = 0.40 + 0.60 * (0.5 + 0.5 * sin(ax * 2.3 + az * 1.7) * sin(bz * 2.1 - bx));
    col += uSunColor * band * chop * 1.05;
    vec3 R = reflect(-V, N);
    col += uSunColor * pow(max(0.0, dot(R, normalize(uSunDir))), 40.0) * 1.6;
    // grazing angles pick up the sky, but only a little: overdo it and a wide
    // shot of the bay turns the sea into fog-coloured sand
    float fres = pow(1.0 - max(0.0, dot(N, V)), 4.0);
    col = mix(col, uHaze * 0.88, fres * 0.34);
    // a pale churn line where the swell meets a piling or the shoreline
    col += vec3(0.12, 0.20, 0.22) * smoothstep(0.86, 1.0, abs(sin(ax * 1.7 + az))) * 0.10;
  } else if (mat > 2.5 && mat < 3.5) {
    // foliage: soft, a little translucency against the sun
    float lam = max(0.0, dot(n, uSunDir)) * 0.55 + 0.45;
    float back = max(0.0, dot(-n, uSunDir)) * 0.35;
    col = base * (lam + back) * vec3(1.06, 1.02, 0.86);
  } else if (mat > 3.5 && mat < 4.5) {
    // unlit paint: road markings, decals, billboards
    col = base;
  } else if (mat > 4.5 && mat < 5.5) {
    // glass: sky reflection plus a warm streak
    float fres = pow(1.0 - max(0.0, dot(n, V)), 2.2);
    col = mix(base * 0.65, uHaze * 1.02, fres * 0.75);
    col += uSunColor * 0.28 * pow(max(0.0, dot(reflect(-V, n), uSunDir)), 18.0);
  } else {
    float lam = max(0.0, dot(n, uSunDir));
    float sky = 0.5 + 0.5 * n.y;
    vec3 amb = mix(vec3(0.30, 0.31, 0.33), vec3(0.30, 0.38, 0.50), sky);
    col = base * (amb + uSunColor * lam * 1.05);
    // cheap occlusion where walls meet the street
    col *= 1.0 - 0.30 * exp(-max(0.0, vWorld.y) * 0.55);
    // warm bounce from the street onto low geometry
    col += base * vec3(0.10, 0.07, 0.04) * exp(-max(0.0, vWorld.y) * 0.16);
  }

  float fog = clamp((dist - 40.0) / uFogEnd, 0.0, 1.0);
  fog = fog * fog;
  float heightFade = 1.0 - clamp(vWorld.y / 260.0, 0.0, 0.45);
  col = mix(col, uHaze, fog * heightFade);

  gl_FragColor = vec4(col, 1.0);
}`;

const SKY_VS = `
attribute vec2 aPos;
uniform vec3 uRight;
uniform vec3 uUp;
uniform vec3 uFwd;
uniform float uTanHalf;
uniform float uAspect;
varying vec3 vDir;
void main() {
  vDir = uFwd + uRight * (aPos.x * uTanHalf * uAspect) + uUp * (aPos.y * uTanHalf);
  gl_Position = vec4(aPos, 0.999, 1.0);
}`;

const SKY_FS = `
precision mediump float;
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y * 1.35 + 0.06, 0.0, 1.0);
  vec3 col = mix(uHorizon, uTop, pow(h, 0.72));
  // haze band along the horizon
  col = mix(col, uHorizon * 1.03, exp(-abs(d.y) * 12.0) * 0.6);
  float sd = max(0.0, dot(d, normalize(uSunDir)));
  col += uSunColor * pow(sd, 220.0) * 6.0;           // disc
  col += uSunColor * pow(sd, 9.0) * 0.34;             // bloom
  col += uSunColor * pow(sd, 2.0) * 0.07;
  // faint high cloud streaks
  float cl = sin(d.x * 7.0 + d.z * 3.0) * sin(d.z * 9.0 - d.x * 2.0);
  col += vec3(0.05, 0.05, 0.06) * smoothstep(0.55, 1.0, cl) * smoothstep(0.05, 0.5, d.y);
  gl_FragColor = vec4(col, 1.0);
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error('shader: ' + gl.getShaderInfoLog(sh));
  }
  return sh;
}

function program(gl, vs, fs, attrs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  for (const [name, loc] of Object.entries(attrs)) gl.bindAttribLocation(p, loc, name);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
  return p;
}

// ---- geometry -------------------------------------------------------------

function boxGeometry() {
  // unit box: x,z in [-0.5,0.5], y in [0,1]
  const pos = [], nrm = [], idx = [];
  const faces = [
    { n: [0, 1, 0], v: [[-.5, 1, -.5], [.5, 1, -.5], [.5, 1, .5], [-.5, 1, .5]] },
    { n: [0, -1, 0], v: [[-.5, 0, .5], [.5, 0, .5], [.5, 0, -.5], [-.5, 0, -.5]] },
    { n: [0, 0, 1], v: [[-.5, 0, .5], [.5, 0, .5], [.5, 1, .5], [-.5, 1, .5]] },
    { n: [0, 0, -1], v: [[.5, 0, -.5], [-.5, 0, -.5], [-.5, 1, -.5], [.5, 1, -.5]] },
    { n: [1, 0, 0], v: [[.5, 0, .5], [.5, 0, -.5], [.5, 1, -.5], [.5, 1, .5]] },
    { n: [-1, 0, 0], v: [[-.5, 0, -.5], [-.5, 0, .5], [-.5, 1, .5], [-.5, 1, -.5]] },
  ];
  for (const f of faces) {
    const base = pos.length / 3;
    for (const v of f.v) { pos.push(v[0], v[1], v[2]); nrm.push(f.n[0], f.n[1], f.n[2]); }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { pos, nrm, idx };
}

function cylinderGeometry(sides = 12) {
  const pos = [], nrm = [], idx = [];
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
    const c0 = Math.cos(a0) * 0.5, s0 = Math.sin(a0) * 0.5;
    const c1 = Math.cos(a1) * 0.5, s1 = Math.sin(a1) * 0.5;
    const base = pos.length / 3;
    pos.push(c0, 0, s0, c1, 0, s1, c1, 1, s1, c0, 1, s0);
    nrm.push(c0 * 2, 0, s0 * 2, c1 * 2, 0, s1 * 2, c1 * 2, 0, s1 * 2, c0 * 2, 0, s0 * 2);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    // caps
    const capBase = pos.length / 3;
    pos.push(0, 1, 0, c0, 1, s0, c1, 1, s1);
    nrm.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
    idx.push(capBase, capBase + 1, capBase + 2);
    const cap2 = pos.length / 3;
    pos.push(0, 0, 0, c1, 0, s1, c0, 0, s0);
    nrm.push(0, -1, 0, 0, -1, 0, 0, -1, 0);
    idx.push(cap2, cap2 + 1, cap2 + 2);
  }
  return { pos, nrm, idx };
}

function sphereGeometry(seg = 10, ring = 6) {
  const pos = [], nrm = [], idx = [];
  for (let y = 0; y <= ring; y++) {
    const v = y / ring, phi = v * Math.PI;
    for (let x = 0; x <= seg; x++) {
      const u = x / seg, th = u * Math.PI * 2;
      const nx = Math.sin(phi) * Math.cos(th) * 0.5;
      const ny = Math.cos(phi) * 0.5;
      const nz = Math.sin(phi) * Math.sin(th) * 0.5;
      pos.push(nx, ny, nz);
      nrm.push(nx * 2, ny * 2, nz * 2);
    }
  }
  for (let y = 0; y < ring; y++) {
    for (let x = 0; x < seg; x++) {
      const a = y * (seg + 1) + x, b = a + seg + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return { pos, nrm, idx };
}

// ---- renderer -------------------------------------------------------------

export function createRenderer(canvas) {
  const opts = { antialias: true, alpha: false, depth: true, powerPreference: 'high-performance' };
  let gl = canvas.getContext('webgl2', opts);
  let isGL2 = !!gl;
  if (!gl) gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
  if (!gl) throw new Error('WebGL is not available in this browser.');

  let ext = null;
  if (!isGL2) {
    ext = gl.getExtension('ANGLE_instanced_arrays');
    if (!ext) throw new Error('This browser lacks instanced drawing.');
  }

  const prog = program(gl, VS, FS, { aPos: 0, aNormal: 1, iOffset: 2, iScale: 3, iRot: 4, iColor: 5 });
  const skyProg = program(gl, SKY_VS, SKY_FS, { aPos: 0 });

  const U = {
    viewProj: gl.getUniformLocation(prog, 'uViewProj'),
    sunDir: gl.getUniformLocation(prog, 'uSunDir'),
    sunColor: gl.getUniformLocation(prog, 'uSunColor'),
    haze: gl.getUniformLocation(prog, 'uHaze'),
    cam: gl.getUniformLocation(prog, 'uCam'),
    time: gl.getUniformLocation(prog, 'uTime'),
    fogEnd: gl.getUniformLocation(prog, 'uFogEnd'),
  };
  const SU = {
    right: gl.getUniformLocation(skyProg, 'uRight'),
    up: gl.getUniformLocation(skyProg, 'uUp'),
    fwd: gl.getUniformLocation(skyProg, 'uFwd'),
    tanHalf: gl.getUniformLocation(skyProg, 'uTanHalf'),
    aspect: gl.getUniformLocation(skyProg, 'uAspect'),
    top: gl.getUniformLocation(skyProg, 'uTop'),
    horizon: gl.getUniformLocation(skyProg, 'uHorizon'),
    sunDir: gl.getUniformLocation(skyProg, 'uSunDir'),
    sunColor: gl.getUniformLocation(skyProg, 'uSunColor'),
  };

  function uploadGeometry(geo) {
    const vao = { pos: gl.createBuffer(), nrm: gl.createBuffer(), idx: gl.createBuffer(), count: geo.idx.length };
    gl.bindBuffer(gl.ARRAY_BUFFER, vao.pos);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(geo.pos), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, vao.nrm);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(geo.nrm), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, vao.idx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(geo.idx), gl.STATIC_DRAW);
    return vao;
  }

  // a cylinder lying on the X axis, for wheels
  const cylX = cylinderGeometry(12);
  for (let i = 0; i < cylX.pos.length; i += 3) {
    const x = cylX.pos[i], y = cylX.pos[i + 1], z = cylX.pos[i + 2];
    cylX.pos[i] = y - 0.5; cylX.pos[i + 1] = x + 0.5; cylX.pos[i + 2] = z;
    const nx = cylX.nrm[i], ny = cylX.nrm[i + 1], nz = cylX.nrm[i + 2];
    cylX.nrm[i] = ny; cylX.nrm[i + 1] = nx; cylX.nrm[i + 2] = nz;
  }

  const geos = {
    box: uploadGeometry(boxGeometry()),
    cyl: uploadGeometry(cylinderGeometry(12)),
    cylx: uploadGeometry(cylX),
    ball: uploadGeometry(sphereGeometry(10, 6)),
  };

  const skyQuad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, skyQuad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

  const divisor = (loc, n) => {
    if (isGL2) gl.vertexAttribDivisor(loc, n);
    else ext.vertexAttribDivisorANGLE(loc, n);
  };
  const drawInst = (mode, count, instances) => {
    if (isGL2) gl.drawElementsInstanced(mode, count, gl.UNSIGNED_SHORT, 0, instances);
    else ext.drawElementsInstancedANGLE(mode, count, gl.UNSIGNED_SHORT, 0, instances);
  };

  // one shared instance buffer per geometry, resized as needed
  const dynBuffers = {};
  function instanceBuffer(key, capacity) {
    let b = dynBuffers[key];
    if (!b) {
      b = { buf: gl.createBuffer(), cap: 0, data: null };
      dynBuffers[key] = b;
    }
    if (b.cap < capacity) {
      b.cap = Math.max(capacity, 512);
      b.data = new Float32Array(b.cap * FLOATS_PER_INSTANCE);
      gl.bindBuffer(gl.ARRAY_BUFFER, b.buf);
      gl.bufferData(gl.ARRAY_BUFFER, b.data.byteLength, gl.DYNAMIC_DRAW);
    }
    return b;
  }

  function bindGeometry(geo, key, instances) {
    gl.bindBuffer(gl.ARRAY_BUFFER, geo.pos);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, geo.nrm);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, geo.idx);
    const b = instanceBuffer(key, instances);
    return b;
  }

  function bindInstances(buf, count) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.buf);
    const stride = FLOATS_PER_INSTANCE * 4;
    const specs = [
      [2, 3, 0], [3, 3, 12], [4, 1, 24], [5, 4, 28],
    ];
    for (const [loc, size, offset] of specs) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset);
      divisor(loc, 1);
    }
    // guard against stale divisor on unused attribute slots
    return count;
  }

  const state = {
    time: 0,
    camPos: [0, 5, 20],
    fwd: [0, 0, -1],
  };

  // Static batch is a plain Float32Array of instances; drawn in one call.
  let staticBatches = [];

  const api = {
    gl,
    canvas,
    state,
    width: canvas.width,
    height: canvas.height,

    setSize(w, h, dpr) {
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      api.width = canvas.width;
      api.height = canvas.height;
    },

    // batches: [{ geometry: 'box'|'cyl'|'ball', data: Float32Array, count }]
    uploadStatic(batches) {
      staticBatches = batches.map((b) => {
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, b.data.subarray(0, b.count * FLOATS_PER_INSTANCE), gl.STATIC_DRAW);
        return { geometry: b.geometry, buf, count: b.count };
      });
    },

    begin(env) {
      const { cam, time } = env;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.disable(gl.BLEND);
      gl.depthMask(true);
      gl.clearColor(SKY.horizon[0], SKY.horizon[1], SKY.horizon[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      const proj = perspective(cam.fov, canvas.width / canvas.height, 0.12, 1400);
      const view = lookAt(cam.pos, cam.target, [0, 1, 0]);
      const vp = multiply(proj, view);
      state.viewProj = vp;
      state.camPos = cam.pos;
      state.time = time;

      // sky
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
      gl.useProgram(skyProg);
      const fwd = normalize(sub(cam.target, cam.pos));
      const right = normalize(cross(fwd, [0, 1, 0]));
      const up = cross(right, fwd);
      gl.uniform3fv(SU.right, right);
      gl.uniform3fv(SU.up, up);
      gl.uniform3fv(SU.fwd, fwd);
      gl.uniform1f(SU.tanHalf, Math.tan(cam.fov / 2));
      gl.uniform1f(SU.aspect, canvas.width / canvas.height);
      gl.uniform3fv(SU.top, SKY.top);
      gl.uniform3fv(SU.horizon, SKY.horizon);
      gl.uniform3fv(SU.sunDir, env.sunDir ?? SUN.dir);
      gl.uniform3fv(SU.sunColor, env.sunColor ?? SUN.color);
      gl.uniform3fv(SU.top, env.top ?? SKY.top);
      gl.uniform3fv(SU.horizon, env.horizon ?? SKY.horizon);
      gl.bindBuffer(gl.ARRAY_BUFFER, skyQuad);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.clear(gl.DEPTH_BUFFER_BIT);

      gl.useProgram(prog);
      gl.uniformMatrix4fv(U.viewProj, false, vp);
      gl.uniform3fv(U.sunDir, env.sunDir ?? SUN.dir);
      gl.uniform3fv(U.sunColor, SUN.color);
      gl.uniform3fv(U.haze, env.haze ?? SKY.haze);
      gl.uniform3fv(U.cam, cam.pos);
      gl.uniform1f(U.time, time);
      gl.uniform1f(U.fogEnd, env.fogEnd ?? SKY.fogEnd);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      gl.frontFace(gl.CCW);
    },

    drawStatic() {
      for (const b of staticBatches) {
        const geo = geos[b.geometry];
        gl.bindBuffer(gl.ARRAY_BUFFER, geo.pos);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, geo.nrm);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, geo.idx);
        gl.bindBuffer(gl.ARRAY_BUFFER, b.buf);
        const stride = FLOATS_PER_INSTANCE * 4;
        gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 0); divisor(2, 1);
        gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 3, gl.FLOAT, false, stride, 12); divisor(3, 1);
        gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 1, gl.FLOAT, false, stride, 24); divisor(4, 1);
        gl.enableVertexAttribArray(5); gl.vertexAttribPointer(5, 4, gl.FLOAT, false, stride, 28); divisor(5, 1);
        drawInst(gl.TRIANGLES, geo.count, b.count);
      }
    },

    // groups: [{ geometry, data, count }]
    drawDynamic(groups) {
      for (const g of groups) {
        if (!g.count) continue;
        const geo = geos[g.geometry];
        const buf = bindGeometry(geo, g.geometry, g.count);
        buf.data.set(g.data.subarray(0, g.count * FLOATS_PER_INSTANCE));
        bindInstances(buf, g.count);
        gl.bindBuffer(gl.ARRAY_BUFFER, buf.buf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, buf.data.subarray(0, g.count * FLOATS_PER_INSTANCE));
        drawInst(gl.TRIANGLES, geo.count, g.count);
      }
    },

    end() {
      // nothing: the browser composites
    },
  };

  return api;
}

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function normalize(a) {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

export { FLOATS_PER_INSTANCE };
