// Vegetation and street furniture: palms along the promenade and on the pavements, low shrubs in
// planters, lamp posts with real emissive lamp heads, bins and bus shelters. All merged into three
// meshes (trunks, fronds, metal) so a hundred palms cost three draw calls.
import * as THREE from 'three';
import { PALETTE } from './config.js';
import { MeshBuilder } from './geometry.js';
import { createRandom } from './rng.js';

/** One palm: a leaning tapered trunk with ring notches, then 8-9 fronds as bent blades. */
function addPalm(trunk, frond, x, z, height, lean, rng) {
  const segments = 8;
  let px = x, pz = z;
  const dirA = rng.range(0, Math.PI * 2);
  const leanAmt = lean * height * 0.22;
  for (let i = 0; i < segments; i += 1) {
    const t0 = i / segments;
    const t1 = (i + 1) / segments;
    const y0 = t0 * height;
    const y1 = t1 * height;
    const bend = Math.sin(t0 * Math.PI * 0.55) * leanAmt;
    const bend1 = Math.sin(t1 * Math.PI * 0.55) * leanAmt;
    const r0 = 0.3 * (1 - t0 * 0.55);
    const r1 = 0.3 * (1 - t1 * 0.55);
    trunk.addCylinder(x + Math.cos(dirA) * bend, z + Math.sin(dirA) * bend, y0, y1, r0, r1, 6,
      new THREE.Color(PALETTE.palmTrunk).multiplyScalar(0.85 + t0 * 0.3), {});
    // ring notch
    if (i > 0) {
      trunk.addCylinder(x + Math.cos(dirA) * bend, z + Math.sin(dirA) * bend, y0 - 0.06, y0 + 0.06,
        r0 * 1.18, r0 * 1.18, 6, new THREE.Color(0x6e5236), {});
    }
    px = x + Math.cos(dirA) * bend1;
    pz = z + Math.sin(dirA) * bend1;
  }
  const topY = height;
  const fronds = 9;
  for (let i = 0; i < fronds; i += 1) {
    const a = (i / fronds) * Math.PI * 2 + rng.range(-0.2, 0.2);
    const len = rng.range(2.6, 4.2) * (height / 11);
    const droop = rng.range(0.5, 1.5);
    const segs = 5;
    let ax = px, az = pz, ay = topY;
    for (let s = 0; s < segs; s += 1) {
      const t0 = s / segs;
      const t1 = (s + 1) / segs;
      const r0 = (0.42 * (1 - t0)) + 0.05;
      const r1 = (0.42 * (1 - t1)) + 0.04;
      const bx = px + Math.cos(a) * len * t1;
      const bz = pz + Math.sin(a) * len * t1;
      const by = topY + Math.sin(t1 * 1.1) * len * 0.32 - droop * t1 * t1 * 1.5;
      const nx = -Math.sin(a), nz = Math.cos(a);
      // two triangles forming a tapering blade, doubled so it is visible from both sides
      for (const side of [1, -1]) {
        const col = new THREE.Color(PALETTE.palmLeaf).multiplyScalar(0.78 + rng.range(0, 0.4));
        frond.addQuad(
          [ax + nx * r0 * side, ay, az + nz * r0 * side],
          [bx + nx * r1 * side, by, bz + nz * r1 * side],
          [bx - nx * r1 * 0.2, by - 0.06, bz - nz * r1 * 0.2],
          [ax - nx * r0 * 0.2, ay - 0.04, az - nz * r0 * 0.2],
          col,
        );
      }
      ax = bx; az = bz; ay = by;
    }
    // coconuts at the crown
    if (i % 3 === 0) {
      trunk.addSphere(px + Math.cos(a) * 0.4, topY - 0.25, pz + Math.sin(a) * 0.4, 0.22, new THREE.Color(0x6a5232));
    }
  }
}

export function createFoliage(city, scene, seed) {
  const rng = createRandom(seed);
  const trunk = new MeshBuilder();
  const frond = new MeshBuilder();
  const metal = new MeshBuilder();
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
  const glow = new MeshBuilder();

  // promenade palms, evenly spaced with slight variation
  const promZ = city.beachZ + 5.5;
  for (let x = -city.maxX - 40; x < city.maxX + 40; x += 13) {
    const h = rng.range(9.5, 14.5);
    addPalm(trunk, frond, x + rng.range(-1.6, 1.6), promZ + rng.range(-1.2, 1.2), h, rng.range(0.25, 0.7), rng);
    city.colliders.push({ minX: x - 0.5, maxX: x + 0.5, minZ: promZ - 0.5, maxZ: promZ + 0.5, top: 12 });
  }
  // pavement palms on the street corners
  for (const block of city.blocks) {
    if (!rng.chance(0.5)) continue;
    const corner = rng.int(0, 3);
    const inset = block.half - 1.4;
    const px = block.x + (corner === 0 || corner === 3 ? -inset : inset);
    const pz = block.z + (corner < 2 ? -inset : inset);
    const h = rng.range(6.5, 10.5);
    addPalm(trunk, frond, px, pz, h, rng.range(0.2, 0.6), rng);
    city.colliders.push({ minX: px - 0.45, maxX: px + 0.45, minZ: pz - 0.45, maxZ: pz + 0.45, top: 10 });
  }
  // planters with shrubs at shopfronts
  const shrubs = new MeshBuilder();
  for (const block of city.blocks) {
    if (!rng.chance(0.7)) continue;
    const n = rng.int(1, 3);
    for (let i = 0; i < n; i += 1) {
      const px = block.x + rng.range(-block.half + 3, block.half - 3);
      const pz = block.z + (rng.chance(0.5) ? -1 : 1) * (block.half - 1.6);
      metal.addBox(px, 0.42, pz, 1.5, 0.6, 0.9, { color: new THREE.Color(0xb0a28e) });
      for (let k = 0; k < 4; k += 1) {
        shrubs.addSphere(px + rng.range(-0.5, 0.5), 0.85, pz + rng.range(-0.3, 0.3), rng.range(0.3, 0.48),
          new THREE.Color(0x4e7a3a).multiplyScalar(rng.range(0.8, 1.2)));
      }
      city.colliders.push({ minX: px - 0.75, maxX: px + 0.75, minZ: pz - 0.45, maxZ: pz + 0.45, top: 1.0 });
    }
  }

  // lamp posts along the pavements and the promenade
  const lampPositions = [...city.lamps];
  for (let x = -city.maxX - 30; x < city.maxX + 30; x += 26) {
    lampPositions.push({ x, z: city.beachZ + 9.4 });
    lampPositions.push({ x, z: city.beachZ + 1.6 });
  }
  for (const lamp of lampPositions) {
    const h = 6.2;
    metal.addCylinder(lamp.x, lamp.z, 0.2, h, 0.13, 0.09, 6, new THREE.Color(0x4a4e54), {});
    metal.addCylinder(lamp.x, lamp.z, h - 0.2, h + 0.05, 0.3, 0.16, 6, new THREE.Color(0x3e4248), {});
    glow.addBox(lamp.x, h + 0.14, lamp.z, 0.46, 0.24, 0.46, { color: new THREE.Color(0xfff0c8) });
    city.colliders.push({ minX: lamp.x - 0.2, maxX: lamp.x + 0.2, minZ: lamp.z - 0.2, maxZ: lamp.z + 0.2, top: h });
  }
  // bins
  for (const bin of city.bins) {
    metal.addCylinder(bin.x, bin.z, 0.2, 1.05, 0.32, 0.36, 6, new THREE.Color(0x3c4a44), { cap: true });
  }

  // bus shelters on the beach boulevard: a glass box with a bench
  for (let i = 0; i < 3; i += 1) {
    const x = -140 + i * 130;
    const z = city.beachZ - 2.4;
    const steel = new THREE.Color(0x7a828a);
    for (const side of [-1, 1]) {
      metal.addBox(x + side * 2.6, 1.2, z, 0.12, 2.4, 1.9, { color: steel });
    }
    metal.addBox(x, 2.5, z, 5.4, 0.16, 2.1, { color: steel, faces: 'nsep' });
    metal.addBox(x, 0.55, z - 0.5, 4.4, 0.14, 0.6, { color: new THREE.Color(0x8a6a48) });
    glow.addBox(x, 2.36, z, 4.6, 0.06, 1.6, { color: new THREE.Color(0xfff4dc) });
  }

  const mkMesh = (b, mat, cast = true) => {
    const m = new THREE.Mesh(b.build(), mat);
    m.castShadow = cast;
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    scene.add(m);
    return m;
  };
  const trunkMesh = mkMesh(trunk, new THREE.MeshLambertMaterial({ vertexColors: true }));
  const frondMesh = mkMesh(frond, new THREE.MeshLambertMaterial({
    vertexColors: true, side: THREE.DoubleSide,
  }));
  const metalMesh = mkMesh(metal, new THREE.MeshLambertMaterial({ vertexColors: true }));
  const shrubMesh = mkMesh(shrubs, new THREE.MeshLambertMaterial({ vertexColors: true }));
  const glowMesh = mkMesh(glow, glowMat, false);
  return { trunkMesh, frondMesh, metalMesh, shrubMesh, glowMesh };
}
