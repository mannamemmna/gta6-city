// Cobalt Bay itself: an island grid of seven by seven blocks, five districts,
// curbs, towers, low-rises, palms, lamps, road paint, the beach and the docks.
// Everything is emitted as instanced primitives plus axis-aligned collision boxes,
// so the renderer can draw the whole city in a handful of calls.

import { CITY, CITY_SEED, DISTRICTS, SKY } from './config.js';
import { cellRng, intRange, pick, range } from './rng.js';

const MAT = { LIT: 0.0, GLOW: 1.0, WATER: 2.0, LEAF: 3.0, FLAT: 4.0, GLASS: 5.0 };

class Builder {
  constructor() { this.batches = { box: [], cyl: [], ball: [] }; }
  add(geo, x, y, z, sx, sy, sz, rot, col, mat = 0) {
    const b = this.batches[geo];
    b.push(x, y, z, sx, sy, sz, rot, col[0], col[1], col[2], mat);
  }
  box(x, y, z, sx, sy, sz, col, rot = 0, mat = 0) { this.add('box', x, y, z, sx, sy, sz, rot, col, mat); }
  cyl(x, y, z, r, h, col, mat = 0) { this.add('cyl', x, y, z, r * 2, h, r * 2, 0, col, mat); }
  ball(x, y, z, r, col, sy = 1, mat = MAT.LEAF) { this.add('ball', x, y, z, r * 2, r * 2 * sy, r * 2, 0, col, mat); }
  finish() {
    const out = [];
    for (const [geo, flat] of Object.entries(this.batches)) {
      if (!flat.length) continue;
      out.push({ geometry: geo, data: new Float32Array(flat), count: flat.length / 11 });
    }
    return out;
  }
}

function shade(c, k) { return [c[0] * k, c[1] * k, c[2] * k]; }
function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

// A spatial hash of solid boxes, queried by circle for movement.
export class ColliderGrid {
  constructor(cell = 16) {
    this.cell = cell;
    this.map = new Map();
    this.all = [];
  }
  key(ix, iz) { return ix * 73856093 ^ iz * 19349663; }
  add(minx, minz, maxx, maxz, h, tag = 'solid') {
    const box = { minx, minz, maxx, maxz, h, tag };
    this.all.push(box);
    const c = this.cell;
    for (let ix = Math.floor(minx / c); ix <= Math.floor(maxx / c); ix++) {
      for (let iz = Math.floor(minz / c); iz <= Math.floor(maxz / c); iz++) {
        const k = this.key(ix, iz);
        let arr = this.map.get(k);
        if (!arr) { arr = []; this.map.set(k, arr); }
        arr.push(box);
      }
    }
    return box;
  }
  query(x, z, r) {
    const c = this.cell;
    const out = [];
    const seen = new Set();
    for (let ix = Math.floor((x - r) / c); ix <= Math.floor((x + r) / c); ix++) {
      for (let iz = Math.floor((z - r) / c); iz <= Math.floor((z + r) / c); iz++) {
        const arr = this.map.get(this.key(ix, iz));
        if (!arr) continue;
        for (const b of arr) {
          if (seen.has(b)) continue;
          seen.add(b);
          if (x + r < b.minx || x - r > b.maxx || z + r < b.minz || z - r > b.maxz) continue;
          out.push(b);
        }
      }
    }
    return out;
  }
  // Push a circle out of every box it overlaps. Returns [x, z].
  resolve(x, z, r) {
    const boxes = this.query(x, z, r);
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (const b of boxes) {
        const cx = Math.max(b.minx, Math.min(x, b.maxx));
        const cz = Math.max(b.minz, Math.min(z, b.maxz));
        let dx = x - cx, dz = z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 > r * r) continue;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          x = cx + (dx / d) * r;
          z = cz + (dz / d) * r;
        } else {
          // centre inside the box: escape on the shallowest axis
          const l = x - b.minx, rr = b.maxx - x, u = z - b.minz, dd = b.maxz - z;
          const m = Math.min(l, rr, u, dd);
          if (m === l) x = b.minx - r; else if (m === rr) x = b.maxx + r;
          else if (m === u) z = b.minz - r; else z = b.maxz + r;
        }
        moved = true;
      }
      if (!moved) break;
    }
    return [x, z];
  }
  hits(x, z, r) {
    const boxes = this.query(x, z, r);
    for (const b of boxes) {
      const cx = Math.max(b.minx, Math.min(x, b.maxx));
      const cz = Math.max(b.minz, Math.min(z, b.maxz));
      const dx = x - cx, dz = z - cz;
      if (dx * dx + dz * dz < r * r) return b;
    }
    return null;
  }
}

export function generateCity() {
  const B = new Builder();
  const col = new ColliderGrid(18);
  const lines = [];
  const blocks = [];
  const landmarks = {};
  const lanes = [];

  const pitch = CITY.pitch;
  const half = CITY.half;
  const road = CITY.road;
  const lineAt = (i) => -half + i * pitch;
  for (let i = 0; i <= CITY.blocks; i++) lines.push(lineAt(i));

  // ---- ground plane pieces ------------------------------------------------
  // Ocean is drawn by the world, not here. This is the island deck.
  const landHalf = 392;
  B.box(0, -0.74, 0, landHalf * 2, 0.72, landHalf * 2, [0.30, 0.30, 0.30], 0, MAT.LIT);
  // pavement slabs under the whole grid, slightly proud of the base
  B.box(0, -0.03, 0, lines[CITY.blocks] - lines[0] + road, 0.03, lines[CITY.blocks] - lines[0] + road,
    [0.235, 0.235, 0.245], 0, MAT.LIT);

  // ---- roads paint --------------------------------------------------------
  const paint = [0.93, 0.90, 0.80];
  const paintDim = [0.78, 0.74, 0.62];
  for (const lx of lines) {
    // crosswalk zebra at every intersection approach
    for (let j = 0; j < CITY.blocks; j++) {
      for (const s of [-1, 1]) {
        for (let k = 0; k < 5; k++) {
          const z = lx === lx ? lineAt(j) + s * (road / 2 + 2.0) : 0;
          const off = (k - 2) * 2.6;
          B.box(lx + off, 0.012, z, 1.2, 0.02, 3.0, paintDim, 0, MAT.FLAT);
        }
      }
    }
  }
  // lane dashes along every road, split around intersections
  for (const lx of lines) {
    for (let j = 0; j < CITY.blocks; j++) {
      const z0 = lineAt(j) + road / 2 + 4, z1 = lineAt(j + 1) - road / 2 - 4;
      for (let z = z0; z < z1; z += 9) {
        B.box(lx, 0.012, z + 1.7, 0.22, 0.02, 3.2, paint, 0, MAT.FLAT);
      }
    }
    for (let i = 0; i < CITY.blocks; i++) {
      const x0 = lineAt(i) + road / 2 + 4, x1 = lineAt(i + 1) - road / 2 - 4;
      for (let x = x0; x < x1; x += 9) {
        B.box(x + 1.7, 0.012, lx, 3.2, 0.02, 0.22, paint, 0, MAT.FLAT);
      }
    }
  }

  // ---- blocks -------------------------------------------------------------
  const downtown = { x: half - 60, z: -half + 80 };
  for (let i = 0; i < CITY.blocks; i++) {
    for (let j = 0; j < CITY.blocks; j++) {
      const rng = cellRng(CITY_SEED, i, j);
      const bx = lineAt(i) + road / 2;
      const bz = lineAt(j) + road / 2;
      const side = CITY.block;
      const cx = bx + side / 2, cz = bz + side / 2;

      // district by position and noise
      let district;
      if (j >= 5) district = DISTRICTS[3];            // beach strip along the south
      else if (i <= 1 && j <= 2) district = DISTRICTS[4];
      else if (i >= 5 && j <= 1) district = DISTRICTS[2];
      else if (j <= 1) district = DISTRICTS[2];
      else if (i >= 1 && i <= 4 && j >= 2 && j <= 4) district = DISTRICTS[0];
      else district = DISTRICTS[1];
      const dIndex = DISTRICTS.indexOf(district);

      // sidewalk slab
      B.box(cx, 0, cz, side + 2.4, CITY.curb, side + 2.4, [0.52, 0.50, 0.47], 0, MAT.LIT);
      // kerb edge
      B.box(cx, 0, bz - 1.1, side + 2.4, 0.16, 0.5, [0.62, 0.60, 0.56], 0, MAT.LIT);

      const inner = side - 6;
      const blockRec = { i, j, x: cx, z: cz, side, district: district.id, height: 0, buildings: [], park: false };
      blocks.push(blockRec);

      // occasional park / plaza
      if (rng() < 0.11 && district.id !== 'heights') {
        blockRec.park = true;
        B.box(cx, CITY.curb, cz, inner + 4, 0.08, inner + 4, [0.18, 0.42, 0.20], 0, MAT.LIT);
        for (let t = 0; t < 9; t++) {
          const tx = cx + range(rng, -inner / 2 + 3, inner / 2 - 3);
          const tz = cz + range(rng, -inner / 2 + 3, inner / 2 - 3);
          const th = range(rng, 4.5, 8.5);
          B.cyl(tx, CITY.curb, tz, 0.20, th * 0.5, [0.30, 0.22, 0.14]);
          B.ball(tx, CITY.curb + th * 0.55, tz, range(rng, 2.0, 3.2), [0.16, 0.36, 0.16], 0.8);
          B.ball(tx + 0.4, CITY.curb + th * 0.55 + 1.4, tz - 0.3, 1.7, [0.20, 0.42, 0.18], 0.75);
          col.add(tx - 0.35, tz - 0.35, tx + 0.35, tz + 0.35, th, 'tree');
        }
        continue;
      }

      // lot subdivision: 2x2 normally, 3x2 for the dense blocks
      const nx = district.id === 'heights' ? 2 : intRange(rng, 2, 3);
      const nz = district.id === 'heights' ? 2 : intRange(rng, 2, 3);
      const lw = inner / nx, ld = inner / nz;
      for (let a = 0; a < nx; a++) {
        for (let b = 0; b < nz; b++) {
          const lx = cx - inner / 2 + lw * (a + 0.5);
          const lz = cz - inner / 2 + ld * (b + 0.5);
          const r2 = cellRng(CITY_SEED + i * 31 + a, j * 17 + b);
          if (r2() < 0.09) continue; // an empty lot / parking gap

          const w = lw * range(r2, 0.62, 0.90);
          const d = ld * range(r2, 0.62, 0.90);
          const downtownness = 1 - Math.min(1, Math.hypot(lx - downtown.x, lz - downtown.z) / 300);
          const tall = district.tall[0] + (district.tall[1] - district.tall[0]) * Math.pow(r2(), 1.7) * (0.45 + downtownness * 0.9);
          const mid = district.mid[0] + (district.mid[1] - district.mid[0]) * r2();
          const h = Math.round(district.id === 'heights' ? tall : r2() < 0.34 ? tall * 0.8 : mid);
          const base = CITY.curb;
          const tint = district.tint;
          const body = mix(tint, [tint[0] * 0.7, tint[1] * 0.7, tint[2] * 0.72], r2() * 0.55);
          const isGlass = h > 42 && r2() < 0.75;

          blockRec.buildings.push({ x: lx, z: lz, w, d, h });
          blockRec.height = Math.max(blockRec.height, h);

          // plinth / storefront band
          B.box(lx, base, lz, w + 1.0, 4.2, d + 1.0, shade(body, 0.72), 0, MAT.LIT);
          B.box(lx, base + 1.0, lz, w + 1.06, 2.4, d + 1.06, [0.10, 0.16, 0.20], 0, MAT.GLASS);

          if (isGlass) {
            const g = mix(body, [0.36, 0.52, 0.60], 0.55);
            B.box(lx, base + 4.2, lz, w, h - 4.2, d, g, 0, MAT.GLASS);
            // vertical mullions
            const n = Math.max(2, Math.round(w / 4));
            for (let m = 0; m <= n; m++) {
              const mx = lx - w / 2 + (w / n) * m;
              B.box(mx, base + 4.2, lz, 0.28, h - 4.2, d + 0.12, shade(body, 0.62));
            }
            for (let m = 0; m <= Math.max(2, Math.round(d / 4)); m++) {
              const mz = lz - d / 2 + (d / Math.max(2, Math.round(d / 4))) * m;
              B.box(lx, base + 4.2, mz, w + 0.12, h - 4.2, 0.28, shade(body, 0.62));
            }
          } else {
            B.box(lx, base + 4.2, lz, w, h - 4.2, d, body, 0, MAT.LIT);
            // window bands, a warm glow on some floors
            const bands = Math.max(1, Math.floor((h - 5) / 3.4));
            for (let f = 0; f < bands; f++) {
              const wy = base + 5.4 + f * 3.4;
              if (wy > h - 1.4) break;
              const lit = r2() < 0.35;
              const wc = lit ? [1.0, 0.78, 0.42] : [0.20, 0.27, 0.32];
              const m = lit ? MAT.GLOW : MAT.GLASS;
              B.box(lx, wy, lz, w * 0.94, 1.15, d + 0.10, wc, 0, m);
              B.box(lx, wy, lz, w + 0.10, 1.15, d * 0.94, wc, 0, m);
            }
          }

          // cornice + roof clutter
          B.box(lx, h, lz, w + 0.7, 0.55, d + 0.7, shade(body, 0.62));
          const tanks = intRange(r2, 0, 2);
          for (let t = 0; t < tanks; t++) {
            const tx = lx + range(r2, -w / 3, w / 3);
            const tz = lz + range(r2, -d / 3, d / 3);
            B.box(tx, h + 0.55, tz, 2.0, 1.0, 2.0, shade(body, 0.55));
            B.cyl(tx, h + 1.55, tz, 0.8, 1.7, [0.34, 0.28, 0.22]);
          }
          if (h > 30 && r2() < 0.5) {
            B.cyl(lx, h + 0.55, lz, 0.12, range(r2, 6, 14), [0.30, 0.30, 0.32]);
          }
          if (h > 34 && r2() < 0.34) {
            B.box(lx, h + 0.55, lz, 1.2, 1.2, 1.2, [0.30, 0.30, 0.32]);
            B.box(lx, h + 1.75, lz, 0.3, 1.1, 0.3, [0.45, 0.10, 0.10], 0, MAT.GLOW);
          }

          col.add(lx - w / 2 - 0.5, lz - d / 2 - 0.5, lx + w / 2 + 0.5, lz + d / 2 + 0.5, h, 'building');
        }
      }

      // ---- street furniture around the kerb ---------------------------------
      const edges = [
        { x: bx + 1.2, z0: bz + 6, z1: bz + side - 6, axis: 'z' },
        { x: bx + side - 1.2, z0: bz + 6, z1: bz + side - 6, axis: 'z' },
        { z: bz + 1.2, x0: bx + 6, x1: bx + side - 6, axis: 'x' },
        { z: bz + side - 1.2, x0: bx + 6, x1: bx + side - 6, axis: 'x' },
      ];
      for (const e of edges) {
        if (e.axis === 'z') {
          for (let z = e.z0; z <= e.z1; z += 17) {
            streetLamp(B, col, e.x, z, rng);
          }
        } else {
          for (let x = e.x0; x <= e.x1; x += 17) {
            streetLamp(B, col, x, e.z, rng);
          }
        }
      }
      // palms on the beach district
      if (district.id === 'solana') {
        for (let k = 0; k < 6; k++) {
          const px = bx + range(rng, 2, side - 2);
          const pz = bz + (k % 2 === 0 ? range(rng, 0.5, 2.5) : side - range(rng, 0.5, 2.5));
          palm(B, col, px, pz, range(rng, 0.85, 1.25));
        }
      }
      if (rng() < 0.3) {
        B.box(bx + side * 0.5, 0.22, bz + 1.0, 1.0, 0.9, 0.6, [0.65, 0.22, 0.16]);
      }
      // road name plate
    }
  }

  // ---- the sea wall, the beach, the docks --------------------------------
  const beachZ = lines[CITY.blocks] + road / 2;
  // sand strip south of the grid
  B.box(0, -0.10, beachZ + 70, 760, 0.14, 150, [0.86, 0.76, 0.56], 0, MAT.LIT);
  B.box(0, 0.04, beachZ + 4, 760, 0.6, 1.2, [0.90, 0.84, 0.70], 0, MAT.LIT);
  for (let k = 0; k < 26; k++) {
    const px = -360 + k * 28 + (k % 3) * 4;
    palm(B, col, px, beachZ + 16 + (k % 4) * 7, 1.0 + (k % 3) * 0.15);
  }
  // pier deck running east into the water
  const pierX = lines[CITY.blocks] + 46;
  B.box(pierX, -0.2, -60, 26, 0.9, 220, [0.36, 0.33, 0.30], 0, MAT.LIT);
  for (let k = 0; k < 14; k++) {
    const pz = -160 + k * 15;
    B.cyl(pierX - 12, -6, pz, 0.9, 7.4, [0.30, 0.27, 0.24]);
    B.cyl(pierX + 12, -6, pz, 0.9, 7.4, [0.30, 0.27, 0.24]);
  }
  // shipping containers
  const contColors = [[0.72, 0.24, 0.18], [0.18, 0.42, 0.52], [0.76, 0.60, 0.18], [0.30, 0.40, 0.28], [0.62, 0.62, 0.60]];
  for (let k = 0; k < 22; k++) {
    const r = cellRng(CITY_SEED + 7, k, 3);
    const gx = pierX + range(r, -11, -1);
    const gz = -170 + k * 9 + range(r, -3, 3);
    const c = pick(r, contColors);
    const stack = intRange(r, 1, 3);
    for (let s = 0; s < stack; s++) {
      B.box(gx, 0.7 + s * 2.7, gz, 7.2, 2.6, 3.0, c);
    }
    col.add(gx - 3.6, gz - 1.5, gx + 3.6, gz + 1.5, 3.5, 'container');
  }
  // gantry cranes
  for (const cz of [-140, -80, -20]) {
    const cx2 = pierX + 20;
    for (const ox of [-9, 9]) {
      for (const oz of [-9, 9]) {
        B.box(cx2 + ox, 0, cz + oz, 1.4, 34, 1.4, [0.70, 0.50, 0.16]);
      }
    }
    B.box(cx2, 34, cz, 22, 1.6, 22, [0.74, 0.54, 0.18]);
    B.box(cx2 + 9, 30.5, cz, 26, 1.2, 2.0, [0.74, 0.54, 0.18]);
    B.box(cx2 + 21, 26, cz, 2.0, 8.0, 2.0, [0.40, 0.40, 0.42]);
    col.add(cx2 - 10, cz - 10, cx2 + 10, cz + 10, 34, 'crane');
  }

  // ---- a few landmark structures -----------------------------------------
  // Cobalt Trust tower: a glass obelisk on the central block
  const lx0 = lineAt(3) + road / 2 + CITY.block / 2;
  const lz0 = lineAt(3) + road / 2 + CITY.block / 2;
  B.box(lx0, CITY.curb, lz0, 22, 9, 22, [0.20, 0.24, 0.28], 0, MAT.LIT);
  B.box(lx0, CITY.curb + 9, lz0, 18, 74, 18, [0.42, 0.56, 0.64], 0, MAT.GLASS);
  for (let f = 0; f < 22; f++) {
    B.box(lx0, CITY.curb + 12 + f * 3.35, lz0, 18.3, 0.5, 18.3, [0.62, 0.72, 0.78], 0, MAT.GLOW);
  }
  B.box(lx0, CITY.curb + 83, lz0, 21, 1.4, 21, [0.72, 0.68, 0.60]);
  B.cyl(lx0, CITY.curb + 84.4, lz0, 0.35, 18, [0.80, 0.80, 0.82]);
  B.ball(lx0, CITY.curb + 103, lz0, 0.55, [1.0, 0.25, 0.20], 1, MAT.GLOW);
  col.add(lx0 - 11, lz0 - 11, lx0 + 11, lz0 + 11, 84, 'tower');
  landmarks.bank = [lx0, lz0];
  landmarks.downtown = [lx0, lz0];

  // The Lantern Club: a low wide hall with a hot pink marquee
  const clubI = 2, clubJ = 4;
  const clubX = lineAt(clubI) + road / 2 + CITY.block / 2;
  const clubZ = lineAt(clubJ) + road / 2 + CITY.block / 2;
  B.box(clubX, CITY.curb, clubZ, 34, 12, 26, [0.26, 0.18, 0.22], 0, MAT.LIT);
  B.box(clubX, CITY.curb + 4, clubZ + 13.2, 30, 4.0, 0.6, [1.0, 0.30, 0.52], 0, MAT.GLOW);
  B.box(clubX, CITY.curb + 12, clubZ, 36, 0.8, 28, [0.20, 0.14, 0.18]);
  for (let k = 0; k < 12; k++) {
    B.ball(clubX - 15 + k * 2.7, CITY.curb + 12.8, clubZ + 14.0, 0.30, [1.0, 0.62, 0.20], 1, MAT.GLOW);
  }
  col.add(clubX - 17, clubZ - 13, clubX + 17, clubZ + 13, 12, 'club');
  landmarks.club = [clubX, clubZ + 16];

  // Solana casino on the beach strip
  const casI = 3, casJ = 6;
  const casX = lineAt(casI) + road / 2 + CITY.block / 2;
  const casZ = lineAt(casJ) + road / 2 + CITY.block / 2;
  B.box(casX, CITY.curb, casZ, 40, 26, 30, [0.86, 0.80, 0.68], 0, MAT.LIT);
  B.box(casX, CITY.curb + 26, casZ, 44, 1.2, 34, [0.90, 0.86, 0.74]);
  B.box(casX, CITY.curb + 18, casZ + 15.2, 38, 6.0, 0.6, [0.24, 0.72, 0.86], 0, MAT.GLOW);
  for (let k = 0; k < 9; k++) {
    B.ball(casX - 16 + k * 4, CITY.curb + 27.4, casZ, 0.9, [1.0, 0.80, 0.30], 1, MAT.GLOW);
  }
  col.add(casX - 20, casZ - 15, casX + 20, casZ + 15, 26, 'casino');
  landmarks.casino = [casX, casZ + 18];

  // safehouse garage in the north-west
  const gI = 0, gJ = 0;
  const gx = lineAt(gI) + road / 2 + CITY.block / 2;
  const gz = lineAt(gJ) + road / 2 + CITY.block / 2;
  B.box(gx, CITY.curb, gz, 26, 7, 20, [0.34, 0.30, 0.26], 0, MAT.LIT);
  B.box(gx, CITY.curb, gz + 10.2, 10, 4.6, 0.6, [0.14, 0.14, 0.16], 0, MAT.GLASS);
  B.box(gx, CITY.curb + 7, gz, 28, 0.6, 22, [0.24, 0.22, 0.20]);
  landmarks.garage = [gx, gz + 13];

  // Ferro Yards warehouse
  const wI = 1, wJ = 1;
  const wx = lineAt(wI) + road / 2 + CITY.block / 2;
  const wz = lineAt(wJ) + road / 2 + CITY.block / 2;
  B.box(wx, CITY.curb, wz, 44, 15, 30, [0.44, 0.42, 0.38], 0, MAT.LIT);
  B.box(wx, CITY.curb + 15, wz, 46, 1.0, 32, [0.36, 0.34, 0.31]);
  for (let k = 0; k < 5; k++) B.box(wx - 16 + k * 8, CITY.curb, wz + 15.2, 6, 7, 0.6, [0.22, 0.24, 0.24], 0, MAT.GLASS);
  landmarks.warehouse = [wx, wz + 18];

  // ---- street lamps, trees along the grid -------------------------------
  // avenue palms every other intersection
  for (let i = 0; i <= CITY.blocks; i += 2) {
    for (let j = 0; j <= CITY.blocks; j += 3) {
      const r = cellRng(CITY_SEED + 99, i, j);
      const px = lineAt(i) + road / 2 + 3;
      const pz = lineAt(j) + range(r, 8, 40);
      palm(B, col, px, pz, range(r, 0.8, 1.1));
    }
  }

  // ---- traffic lanes and graph ------------------------------------------
  const nodes = [];
  for (let i = 0; i <= CITY.blocks; i++) {
    nodes[i] = [];
    for (let j = 0; j <= CITY.blocks; j++) {
      nodes[i][j] = { i, j, x: lineAt(i), z: lineAt(j), links: [] };
    }
  }
  for (let i = 0; i <= CITY.blocks; i++) {
    for (let j = 0; j <= CITY.blocks; j++) {
      const n = nodes[i][j];
      if (i > 0) n.links.push(nodes[i - 1][j]);
      if (i < CITY.blocks) n.links.push(nodes[i + 1][j]);
      if (j > 0) n.links.push(nodes[i][j - 1]);
      if (j < CITY.blocks) n.links.push(nodes[i][j + 1]);
    }
  }

  return {
    batches: B.finish(),
    colliders: col,
    blocks,
    lines,
    nodes,
    landmarks,
    roadWidth: road,
    landHalf,
    beachZ,
    minimapRoads: lines,
  };
}

function streetLamp(B, col, x, z, rng) {
  const h = 7.2;
  B.cyl(x, CITY.curb, z, 0.14, h, [0.24, 0.25, 0.27]);
  B.box(x, CITY.curb + h, z, 1.5, 0.18, 0.22, [0.24, 0.25, 0.27]);
  B.box(x + 0.65, CITY.curb + h - 0.22, z, 0.55, 0.18, 0.30, [1.0, 0.84, 0.58], 0, MAT.GLOW);
  col.add(x - 0.22, z - 0.22, x + 0.22, z + 0.22, h, 'lamp');
}

function palm(B, col, x, z, scale) {
  const h = 7.5 * scale;
  let px = x, pz = z;
  const segs = 4;
  for (let s = 0; s < segs; s++) {
    const lean = 0.10 * scale * s;
    B.cyl(px, CITY.curb + (h / segs) * s, pz, 0.26 - s * 0.045, h / segs + 0.1,
      [0.42 - s * 0.02, 0.33 - s * 0.015, 0.22], 0);
    px += lean; pz += lean * 0.4;
  }
  const top = CITY.curb + h;
  for (let f = 0; f < 6; f++) {
    const a = (f / 6) * Math.PI * 2 + 0.4;
    B.add('box', px + Math.cos(a) * 1.5, top - 0.2, pz + Math.sin(a) * 1.5,
      3.4, 0.22, 0.9, a, [0.20, 0.36, 0.16], MAT.LEAF);
  }
  B.ball(px, top + 0.25, pz, 0.55, [0.26, 0.34, 0.14], 0.7);
  col.add(x - 0.3, z - 0.3, x + 0.3, z + 0.3, h, 'palm');
}
