// Geometry batching and procedural canvas textures. The whole city is merged into a handful of
// meshes here (walls, roofs, asphalt, sidewalk, markings, foliage) so a software renderer can draw
// thousands of windows and palm fronds in a few calls. Nothing is loaded from disk or the network:
// every texture below is painted at boot into a canvas.
import * as THREE from 'three';
import { createRandom } from './rng.js';

const WALL_COLORS = [
  '#efe3cc', '#f2d9c2', '#e8cbb0', '#dfe6dd', '#cfe0e2', '#f0d3c6',
  '#e6d8bf', '#d9c3a5', '#c9d6d1', '#f4e6d7', '#d8c8b4', '#bcd2d6',
];
const GLASS_TINTS = ['#2b4a58', '#35525c', '#27414f', '#3b5b63', '#2e4d5a'];
const ACCENTS = ['#e2674f', '#d9a13c', '#4b8f7d', '#c9566f', '#3f7fa8', '#e0b04f'];

/** A growable, non-indexed mesh accumulator: positions, normals, uvs and per-vertex colour. */
export class MeshBuilder {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.col = [];
    this.verts = 0;
  }

  vertex(x, y, z, nx, ny, nz, u, v, color) {
    this.pos.push(x, y, z);
    this.nrm.push(nx, ny, nz);
    this.uv.push(u, v);
    this.col.push(color.r, color.g, color.b);
    this.verts += 1;
  }

  /** Adds a quad from four corners given counter-clockwise seen from the front. */
  addQuad(a, b, c, d, color, uva = [0, 0], uvb = [1, 0], uvc = [1, 1], uvd = [0, 1], normal = null) {
    const n = normal ?? faceNormal(a, b, c);
    if (!Number.isFinite(n[0]) || !Number.isFinite(n[1]) || !Number.isFinite(n[2])) return this;
    this.vertex(a[0], a[1], a[2], n[0], n[1], n[2], uva[0], uva[1], color);
    this.vertex(b[0], b[1], b[2], n[0], n[1], n[2], uvb[0], uvb[1], color);
    this.vertex(c[0], c[1], c[2], n[0], n[1], n[2], uvc[0], uvc[1], color);
    this.vertex(a[0], a[1], a[2], n[0], n[1], n[2], uva[0], uva[1], color);
    this.vertex(c[0], c[1], c[2], n[0], n[1], n[2], uvc[0], uvc[1], color);
    this.vertex(d[0], d[1], d[2], n[0], n[1], n[2], uvd[0], uvd[1], color);
    return this;
  }

  /** A box with optional per-face colours and a shared uv rect; `faces` limits which sides are drawn. */
  addBox(cx, cy, cz, w, h, d, opts = {}) {
    const color = opts.color ?? new THREE.Color(0xcccccc);
    const top = opts.topColor ?? color;
    const uv = opts.uv ?? [0, 0, 1, 1];
    const faces = opts.faces ?? 'eswnpt';
    const x0 = cx - w / 2, x1 = cx + w / 2;
    const y0 = cy - h / 2, y1 = cy + h / 2;
    const z0 = cz - d / 2, z1 = cz + d / 2;
    const [u0, v0, u1, v1] = uv;
    if (faces.includes('n')) this.addQuad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], color, [u1, v0], [u1, v1], [u0, v1], [u0, v0], [0, 0, -1]);
    if (faces.includes('s')) this.addQuad([x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [x0, y0, z1], color, [u1, v0], [u1, v1], [u0, v1], [u0, v0], [0, 0, 1]);
    if (faces.includes('e')) this.addQuad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], color, [u0, v0], [u0, v1], [u1, v1], [u1, v0], [1, 0, 0]);
    if (faces.includes('w')) this.addQuad([x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0], color, [u0, v0], [u0, v1], [u1, v1], [u1, v0], [-1, 0, 0]);
    if (faces.includes('p')) this.addQuad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], top, [u0, v0], [u1, v0], [u1, v1], [u0, v1], [0, 1, 0]);
    if (faces.includes('t')) this.addQuad([x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0], color, [u0, v0], [u1, v0], [u1, v1], [u0, v1], [0, -1, 0]);
    return this;
  }

  /** A flat rectangle lying in XZ, facing up. */
  addGround(x0, z0, x1, z1, y, color, uv = [0, 0, 1, 1], repeats = 1) {
    const [u0, v0, u1, v1] = uv;
    const r = repeats;
    this.addQuad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], color,
      [u0, v1 * r], [u1 * r, v1 * r], [u1 * r, v0], [u0, v0], [0, 1, 0]);
    return this;
  }

  /** Open-ended cylinder, low segment count: trunks, poles, bollards. */
  addCylinder(cx, cz, y0, y1, r0, r1, segments, color, opts = {}) {
    const cap = opts.cap ?? false;
    for (let i = 0; i < segments; i += 1) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 1) / segments) * Math.PI * 2;
      const p0 = [cx + Math.cos(a0) * r0, y0, cz + Math.sin(a0) * r0];
      const p1 = [cx + Math.cos(a1) * r0, y0, cz + Math.sin(a1) * r0];
      const p2 = [cx + Math.cos(a1) * r1, y1, cz + Math.sin(a1) * r1];
      const p3 = [cx + Math.cos(a0) * r1, y1, cz + Math.sin(a0) * r1];
      const nm = [(p0[0] + p1[0]) / 2 - cx, 0, (p0[2] + p1[2]) / 2 - cz];
      const len = Math.hypot(nm[0], nm[2]) || 1;
      this.addQuad(p0, p3, p2, p1, color, [0, 0], [0, 1], [1, 1], [1, 0], [nm[0] / len, 0, nm[2] / len]);
    }
    if (cap && r1 > 0) this.addGround(cx - r1, cz - r1, cx + r1, cz + r1, y1, color, [0, 0, 1, 1]);
    return this;
  }

  addSphere(cx, cy, cz, r, color) {
    // Built from explicit triangles: an icosahedron-ish quad patch with no degenerate faces, so no
    // zero-length normals can leak into the merged buffer.
    const rings = 4, segs = 7;
    const p = (i, j) => {
      const phi = (i / rings) * Math.PI;
      const theta = (j / segs) * Math.PI * 2;
      return [cx + Math.sin(phi) * Math.cos(theta) * r, cy + Math.cos(phi) * r, cz + Math.sin(phi) * Math.sin(theta) * r];
    };
    for (let i = 0; i < rings; i += 1) {
      for (let j = 0; j < segs; j += 1) {
        const a = p(i, j), b = p(i + 1, j), c = p(i + 1, j + 1), d = p(i, j + 1);
        const tris = [[a, b, c], [a, c, d]];
        for (const [t0, t1, t2] of tris) {
          const n = faceNormal(t0, t1, t2);
          if (!Number.isFinite(n[0])) continue;
          this.vertex(t0[0], t0[1], t0[2], n[0], n[1], n[2], 0, 0, color);
          this.vertex(t1[0], t1[1], t1[2], n[0], n[1], n[2], 1, 0, color);
          this.vertex(t2[0], t2[1], t2[2], n[0], n[1], n[2], 1, 1, color);
        }
      }
    }
    return this;
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

function faceNormal(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

/** Paints a plane-fill canvas. */
export function makeCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext('2d') };
}

export function canvasTexture(canvas, { repeat = 1, aniso = 8, srgb = true } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = aniso;
  tex.needsUpdate = true;
  return tex;
}

const hexToRgb = (hex) => {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};
const shade = (hex, amount) => {
  const [r, g, b] = hexToRgb(hex);
  const f = (n) => Math.max(0, Math.min(255, Math.round(n * amount)));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
};

/**
 * A facade atlas: 4x4 painted building fronts. Each cell is one complete street wall (parapet,
 * floors of windows, ground floor). Windows genuinely differ per cell, which is what stops the
 * skyline reading as one repeating box.
 */
export function createFacadeAtlas(seed, floors, mode) {
  const SIZE = 1024;
  const CELL = 256;
  const { canvas, ctx } = makeCanvas(SIZE, SIZE);
  const rng = createRandom(seed);
  const cells = [];
  for (let gy = 0; gy < 4; gy += 1) {
    for (let gx = 0; gx < 4; gx += 1) {
      const ox = gx * CELL;
      const oy = gy * CELL;
      const wall = rng.pick(WALL_COLORS);
      ctx.save();
      ctx.beginPath();
      ctx.rect(ox, oy, CELL, CELL);
      ctx.clip();
      // wall base with a soft vertical light gradient (sun from the west, so tops a touch warmer)
      const grad = ctx.createLinearGradient(ox, oy, ox, oy + CELL);
      grad.addColorStop(0, shade(wall, 1.06));
      grad.addColorStop(0.55, wall);
      grad.addColorStop(1, shade(wall, 0.86));
      ctx.fillStyle = grad;
      ctx.fillRect(ox, oy, CELL, CELL);

      // faint horizontal floor lines / stone banding
      ctx.strokeStyle = shade(wall, 0.9);
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1;
      for (let i = 1; i < floors; i += 1) {
        const y = oy + (i / floors) * CELL + 2;
        ctx.beginPath();
        ctx.moveTo(ox, y);
        ctx.lineTo(ox + CELL, y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      const cols = mode === 'tower' ? 4 : 3;
      const marginX = 14;
      const cellW = (CELL - marginX * 2) / cols;
      const floorH = CELL / floors;
      const winW = cellW * (mode === 'tower' ? 0.74 : 0.6);
      const winH = floorH * (mode === 'tower' ? 0.62 : 0.52);
      const tint = rng.pick(GLASS_TINTS);
      const accent = rng.pick(ACCENTS);

      for (let f = 0; f < floors; f += 1) {
        const isGround = f === floors - 1 && mode === 'shop';
        const fy = oy + f * floorH;
        if (isGround) {
          // storefront: dark glass, door, awning stripes
          ctx.fillStyle = '#1d2a2e';
          ctx.fillRect(ox + 6, fy + floorH * 0.22, CELL - 12, floorH * 0.7);
          ctx.fillStyle = shade(accent, 1.0);
          ctx.fillRect(ox + 6, fy + floorH * 0.06, CELL - 12, floorH * 0.16);
          ctx.fillStyle = shade(accent, 0.62);
          for (let s = 0; s < 7; s += 1) {
            ctx.fillRect(ox + 8 + s * (CELL - 16) / 7, fy + floorH * 0.06, (CELL - 16) / 14, floorH * 0.16);
          }
          ctx.fillStyle = 'rgba(255,236,190,0.55)';
          ctx.fillRect(ox + 22, fy + floorH * 0.34, 34, floorH * 0.5);
          ctx.fillStyle = 'rgba(200,232,255,0.14)';
          ctx.fillRect(ox + 6, fy + floorH * 0.22, CELL - 12, floorH * 0.3);
          continue;
        }
        for (let c = 0; c < cols; c += 1) {
          const wx = ox + marginX + c * cellW + (cellW - winW) / 2;
          const wy = fy + (floorH - winH) / 2 + floorH * 0.04;
          // recessed frame
          ctx.fillStyle = 'rgba(30,30,34,0.35)';
          ctx.fillRect(wx - 3, wy - 3, winW + 6, winH + 6);
          const lit = rng.chance(mode === 'tower' ? 0.3 : 0.22);
          if (lit) {
            const lg = ctx.createLinearGradient(wx, wy, wx, wy + winH);
            lg.addColorStop(0, '#ffe9b8');
            lg.addColorStop(1, '#f0b060');
            ctx.fillStyle = lg;
          } else {
            const gg = ctx.createLinearGradient(wx, wy, wx + winW, wy + winH);
            gg.addColorStop(0, shade(tint, 1.35));
            gg.addColorStop(0.6, tint);
            gg.addColorStop(1, shade(tint, 0.7));
            ctx.fillStyle = gg;
          }
          ctx.fillRect(wx, wy, winW, winH);
          // sill + mullion
          ctx.fillStyle = 'rgba(255,255,255,0.22)';
          ctx.fillRect(wx, wy + winH - 2, winW, 2);
          ctx.fillStyle = 'rgba(20,24,28,0.3)';
          ctx.fillRect(wx + winW / 2 - 1, wy, 2, winH);
          if (mode === 'shop' && rng.chance(0.5)) {
            ctx.fillStyle = shade(wall, 0.8);
            ctx.fillRect(wx - 8, wy + winH + 2, winW + 16, 5);
          }
        }
        if (mode === 'tower') {
          ctx.fillStyle = 'rgba(255,255,255,0.18)';
          ctx.fillRect(ox + marginX, fy + 1, CELL - marginX * 2, 2);
        }
      }
      // vertical pilasters on some variants
      if (rng.chance(0.45)) {
        ctx.fillStyle = shade(wall, 0.92);
        ctx.globalAlpha = 0.85;
        ctx.fillRect(ox + 4, oy, 5, CELL);
        ctx.fillRect(ox + CELL - 9, oy, 5, CELL);
        ctx.globalAlpha = 1;
      }
      // parapet / cornice at the top
      ctx.fillStyle = shade(wall, 1.12);
      ctx.fillRect(ox, oy, CELL, mode === 'tower' ? 10 : 14);
      ctx.fillStyle = 'rgba(0,0,0,0.14)';
      ctx.fillRect(ox, oy + (mode === 'tower' ? 10 : 14), CELL, 3);
      ctx.restore();
      cells.push({ u0: (gx * CELL + 2) / SIZE, v0: (gy * CELL + 2) / SIZE, u1: ((gx + 1) * CELL - 2) / SIZE, v1: ((gy + 1) * CELL - 2) / SIZE });
    }
  }
  return { texture: canvasTexture(canvas, { aniso: 4 }), cells };
}

/**
 * A single-floor facade tile, 256x256 for ~3.6 m of wall: one bay of windows with a wall margin on
 * every edge so the tile repeats seamlessly in both directions. Buildings set their uv repeat to
 * (metres / 3.6) which is what keeps windows at a believable human size on a 6 m shop and a 90 m
 * tower alike.
 */
export function createFacadeTile(seed, opts = {}) {
  const SIZE = 256;
  const { canvas, ctx } = makeCanvas(SIZE, SIZE);
  const rng = createRandom(seed);
  const wall = opts.wall ?? '#ece0ca';
  const glass = opts.glass ?? '#2f4c58';
  const bays = opts.bays ?? 2;
  const band = opts.band ?? 0.14;      // wall margin as a fraction
  const litChance = opts.lit ?? 0.14;
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, SIZE, SIZE);
  // subtle plaster grain
  for (let i = 0; i < 2600; i += 1) {
    ctx.fillStyle = `rgba(${rng.chance(0.5) ? '255,255,255' : '0,0,0'},${rng.range(0.01, 0.05)})`;
    ctx.fillRect(rng.range(0, SIZE), rng.range(0, SIZE), rng.range(1, 3), rng.range(1, 3));
  }
  const bw = SIZE / bays;
  for (let b = 0; b < bays; b += 1) {
    const x0 = b * bw;
    const wx = x0 + bw * band;
    const ww = bw * (1 - band * 2);
    const wy = SIZE * band * 1.5;
    const wh = SIZE * (1 - band * 3.1);
    // recess shadow
    ctx.fillStyle = 'rgba(28,30,34,0.42)';
    ctx.fillRect(wx - 5, wy - 5, ww + 10, wh + 10);
    const lit = rng.chance(litChance);
    const g = ctx.createLinearGradient(wx, wy, wx + ww * 0.4, wy + wh);
    if (lit) {
      g.addColorStop(0, '#ffe9bd');
      g.addColorStop(0.55, '#f6c983');
      g.addColorStop(1, '#d99a58');
    } else {
      g.addColorStop(0, shade(glass, 1.9));
      g.addColorStop(0.35, shade(glass, 1.15));
      g.addColorStop(1, shade(glass, 0.72));
    }
    ctx.fillStyle = g;
    ctx.fillRect(wx, wy, ww, wh);
    // reflection streak
    ctx.fillStyle = 'rgba(255,255,255,0.13)';
    ctx.beginPath();
    ctx.moveTo(wx + ww * 0.08, wy + wh);
    ctx.lineTo(wx + ww * 0.46, wy);
    ctx.lineTo(wx + ww * 0.68, wy);
    ctx.lineTo(wx + ww * 0.3, wy + wh);
    ctx.closePath();
    ctx.fill();
    if (!lit) {
      // an interior hint: a curtain or blinds on some windows
      if (rng.chance(0.4)) {
        ctx.fillStyle = 'rgba(226,214,196,0.5)';
        ctx.fillRect(wx, wy, ww, wh * rng.range(0.18, 0.5));
      }
    }
    // mullions
    ctx.fillStyle = 'rgba(36,38,42,0.55)';
    ctx.fillRect(wx + ww / 2 - 1.5, wy, 3, wh);
    ctx.fillRect(wx, wy + wh * 0.45, ww, 2.5);
    // frame + sill
    ctx.strokeStyle = 'rgba(250,244,230,0.65)';
    ctx.lineWidth = 3;
    ctx.strokeRect(wx - 2, wy - 2, ww + 4, wh + 4);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(wx - 6, wy + wh + 3, ww + 12, 5);
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    ctx.fillRect(wx - 6, wy + wh + 8, ww + 12, 4);
  }
  // floor line at the very top of the tile (so a stack of tiles reads as floors)
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fillRect(0, 0, SIZE, 3);
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  ctx.fillRect(0, SIZE - 5, SIZE, 5);
  return canvasTexture(canvas, { aniso: 8 });
}

/** A glazed curtain-wall tile for downtown towers: ribbon glass, thin spandrel, vertical fins. */
export function createTowerTile(seed, opts = {}) {
  const SIZE = 256;
  const { canvas, ctx } = makeCanvas(SIZE, SIZE);
  const rng = createRandom(seed);
  const spandrel = opts.spandrel ?? '#cfd4ce';
  const glass = opts.glass ?? '#33525f';
  ctx.fillStyle = spandrel;
  ctx.fillRect(0, 0, SIZE, SIZE);
  const top = SIZE * 0.12;
  const h = SIZE * 0.68;
  const g = ctx.createLinearGradient(0, top, SIZE, top + h);
  g.addColorStop(0, shade(glass, 1.75));
  g.addColorStop(0.4, shade(glass, 1.0));
  g.addColorStop(0.75, shade(glass, 0.66));
  g.addColorStop(1, shade(glass, 1.25));
  ctx.fillStyle = g;
  ctx.fillRect(0, top, SIZE, h);
  // lit offices
  for (let i = 0; i < 10; i += 1) {
    if (!rng.chance(0.3)) continue;
    ctx.fillStyle = `rgba(255,226,168,${rng.range(0.25, 0.8)})`;
    const w = SIZE / 10;
    ctx.fillRect(i * w + 2, top + 3, w - 5, h * rng.range(0.4, 0.95));
  }
  // vertical fins + horizontal rails
  ctx.fillStyle = 'rgba(238,242,238,0.55)';
  for (let i = 0; i <= 8; i += 1) {
    ctx.fillRect((i * SIZE) / 8 - 1.4, top, 3, h);
  }
  ctx.fillStyle = 'rgba(250,250,248,0.85)';
  ctx.fillRect(0, top - 4, SIZE, 6);
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.fillRect(0, top + h, SIZE, 5);
  // spandrel shadow bands
  ctx.fillStyle = 'rgba(0,0,0,0.1)';
  ctx.fillRect(0, SIZE - 16, SIZE, 16);
  return canvasTexture(canvas, { aniso: 8 });
}

/**
 * The ground floor of a commercial building: a bay of shop windows with an awning and a painted
 * sign band. 256x256 covers ~3.6 m wide by ~4.2 m tall.
 */
export function createStorefrontTile(seed, opts = {}) {
  const SIZE = 256;
  const { canvas, ctx } = makeCanvas(SIZE, SIZE);
  const rng = createRandom(seed);
  const wall = opts.wall ?? '#efe2cb';
  const accent = opts.accent ?? '#c9566f';
  const bays = opts.bays ?? 2;
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, SIZE, SIZE);
  const bw = SIZE / bays;
  for (let b = 0; b < bays; b += 1) {
    const x0 = b * bw;
    // shop window: warm interior
    const wx = x0 + bw * 0.1;
    const ww = bw * 0.8;
    const wy = SIZE * 0.4;
    const wh = SIZE * 0.5;
    const g = ctx.createLinearGradient(0, wy, 0, wy + wh);
    g.addColorStop(0, '#3a2a1e');
    g.addColorStop(0.35, '#f0c88a');
    g.addColorStop(1, '#c68b4a');
    ctx.fillStyle = g;
    ctx.fillRect(wx, wy, ww, wh);
    ctx.fillStyle = 'rgba(20,24,28,0.35)';
    ctx.fillRect(wx + ww * 0.44, wy, ww * 0.12, wh);
    // a silhouette of shelving
    ctx.fillStyle = 'rgba(60,40,26,0.55)';
    ctx.fillRect(wx + 4, wy + wh * 0.55, ww - 8, wh * 0.4);
    // door
    if (b === 0) {
      ctx.fillStyle = 'rgba(30,26,22,0.85)';
      ctx.fillRect(wx + 3, wy + wh * 0.28, ww * 0.2, wh * 0.72);
      ctx.fillStyle = 'rgba(255,236,190,0.5)';
      ctx.fillRect(wx + ww * 0.085, wy + wh * 0.36, ww * 0.05, wh * 0.5);
    }
    // awning
    ctx.fillStyle = accent;
    ctx.fillRect(x0 + 2, SIZE * 0.2, bw - 4, SIZE * 0.14);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    for (let s = 0; s < 5; s += 1) {
      ctx.fillRect(x0 + 6 + s * ((bw - 12) / 5), SIZE * 0.2, (bw - 12) / 10, SIZE * 0.14);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(x0 + 2, SIZE * 0.34, bw - 4, 6);
    // sign band above the awning
    ctx.fillStyle = shade(accent, 0.7);
    ctx.fillRect(x0 + 6, SIZE * 0.06, bw - 12, SIZE * 0.1);
    ctx.fillStyle = 'rgba(255,244,222,0.75)';
    for (let s = 0; s < 4; s += 1) {
      ctx.fillRect(x0 + 14 + s * ((bw - 24) / 4), SIZE * 0.09, (bw - 24) / 8, SIZE * 0.04);
    }
    // pavement shadow at the base
    ctx.fillStyle = 'rgba(0,0,0,0.42)';
    ctx.fillRect(0, SIZE - 14, SIZE, 14);
  }
  return canvasTexture(canvas, { aniso: 8 });
}

/** Asphalt with grit and tar seams. */
export function createAsphaltTexture(seed) {
  const { canvas, ctx } = makeCanvas(256, 256);
  const rng = createRandom(seed);
  ctx.fillStyle = '#585862';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 5200; i += 1) {
    const v = rng.range(0.72, 1.12);
    const g = Math.round(90 * v);
    ctx.fillStyle = `rgba(${g},${g},${g + 4},${rng.range(0.15, 0.5)})`;
    ctx.fillRect(rng.range(0, 256), rng.range(0, 256), rng.range(1, 3), rng.range(1, 3));
  }
  ctx.strokeStyle = 'rgba(30,30,34,0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 40); ctx.bezierCurveTo(80, 52, 160, 26, 256, 44);
  ctx.stroke();
  return canvasTexture(canvas, { repeat: 1 });
}

/** Sidewalk paving slabs. */
export function createSidewalkTexture(seed) {
  const { canvas, ctx } = makeCanvas(256, 256);
  const rng = createRandom(seed);
  ctx.fillStyle = '#cdc0ab';
  ctx.fillRect(0, 0, 256, 256);
  const n = 4;
  const s = 256 / n;
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const v = rng.range(0.93, 1.06);
      const base = hexToRgb('#cdc0ab').map((c) => Math.round(c * v));
      ctx.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
      ctx.fillRect(x * s + 1, y * s + 1, s - 2, s - 2);
    }
  }
  for (let i = 0; i < 2400; i += 1) {
    ctx.fillStyle = `rgba(120,105,88,${rng.range(0.03, 0.16)})`;
    ctx.fillRect(rng.range(0, 256), rng.range(0, 256), rng.range(1, 3), rng.range(1, 3));
  }
  return canvasTexture(canvas, { repeat: 1 });
}

/** Sand for the beach. */
export function createSandTexture(seed) {
  const { canvas, ctx } = makeCanvas(256, 256);
  const rng = createRandom(seed);
  ctx.fillStyle = '#e6cf9f';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9000; i += 1) {
    const v = rng.range(0.82, 1.1);
    const c = hexToRgb('#e6cf9f').map((n) => Math.round(n * v));
    ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},0.6)`;
    ctx.fillRect(rng.range(0, 256), rng.range(0, 256), rng.range(1, 2), rng.range(1, 2));
  }
  // wind ripples
  ctx.strokeStyle = 'rgba(196,168,120,0.28)';
  for (let i = 0; i < 14; i += 1) {
    ctx.beginPath();
    const y = rng.range(0, 256);
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(70, y + 8, 150, y - 9, 256, y + 3);
    ctx.lineWidth = rng.range(1, 2.5);
    ctx.stroke();
  }
  return canvasTexture(canvas, { repeat: 1 });
}

/** A soft wave normal map so the sea catches the low sun. */
export function createWaterNormal(seed) {
  const { canvas, ctx } = makeCanvas(256, 256);
  const rng = createRandom(seed);
  ctx.fillStyle = '#8080ff';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 260; i += 1) {
    const x = rng.range(0, 256);
    const y = rng.range(0, 256);
    const w = rng.range(10, 46);
    const g = ctx.createRadialGradient(x, y, 0, x, y, w);
    g.addColorStop(0, 'rgba(150,150,255,0.55)');
    g.addColorStop(1, 'rgba(128,128,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, w, w * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(24, 24);
  return tex;
}

/** Painted billboard / storefront sign art, so signage is original art, not text on a plane only. */
export function createSignTexture(text, sub, bg, fg) {
  const { canvas, ctx } = makeCanvas(512, 128);
  const g = ctx.createLinearGradient(0, 0, 512, 128);
  g.addColorStop(0, bg);
  g.addColorStop(1, shade(bg, 0.7));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 6;
  ctx.strokeRect(6, 6, 500, 116);
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 62px Georgia, serif';
  ctx.fillText(text, 256, sub ? 52 : 64);
  if (sub) {
    ctx.font = 'italic 26px Georgia, serif';
    ctx.fillStyle = 'rgba(255,255,255,0.78)';
    ctx.fillText(sub, 256, 98);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Vertical neon blade sign for a hotel or club. */
export function createBladeTexture(text, bg, fg) {
  const { canvas, ctx } = makeCanvas(128, 512);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 128, 512);
  ctx.strokeStyle = fg;
  ctx.lineWidth = 5;
  ctx.strokeRect(6, 6, 116, 500);
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 62px Georgia, serif';
  const chars = text.split('');
  const step = 470 / chars.length;
  chars.forEach((ch, i) => ctx.fillText(ch, 64, 40 + step * (i + 0.5)));
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export { WALL_COLORS, GLASS_TINTS, ACCENTS, shade, hexToRgb };
