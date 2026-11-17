// The city of Vela Costa, generated from a seed: a grid of blocks cut by four-lane roads, a
// downtown of terraced towers, mid-rise commercial blocks, low-rise beachfront hotels, a palm
// promenade, sand and sea, and a pier. Every wall is UV-mapped in metres so windows stay the same
// believable size on a 6 m shop and a 90 m tower. Geometry is merged per material, and the whole
// set casts and receives shadow. It also publishes the collision boxes, the road grid, the minimap
// art and the kerbside parking spots that the rest of the game reads.
import * as THREE from 'three';
import { CITY, PALETTE } from './config.js';
import {
  MeshBuilder, createFacadeTile, createTowerTile, createStorefrontTile, createAsphaltTexture,
  createSidewalkTexture, createSandTexture, createWaterNormal, createSignTexture, createBladeTexture,
  ACCENTS, WALL_COLORS, GLASS_TINTS,
} from './geometry.js';
import { createRandom } from './rng.js';

const PITCH = CITY.pitch;
const ROAD = CITY.road;
const LOT = PITCH - ROAD;
const PAVE = 3.6;
const DOWNTOWN = { x: 0, z: -46 };

const WALL_TILES = 3.6;       // metres per facade tile
const STORE_TILE_H = 4.4;     // ground-floor height
const PAVE_TILE = 4.0;

export function createCity(seed, scene) {
  const rng = createRandom(seed);
  const root = new THREE.Group();
  root.name = 'city';
  scene.add(root);

  const blocksX = CITY.blocksX;
  const blocksZ = CITY.blocksZ;
  const roadX = [];
  const roadZ = [];
  for (let i = 0; i <= blocksX; i += 1) roadX.push(-blocksX * PITCH / 2 + i * PITCH);
  for (let j = 0; j <= blocksZ; j += 1) roadZ.push(-blocksZ * PITCH / 2 + j * PITCH);

  const city = {
    seed, root, roadX, roadZ,
    pitch: PITCH, roadWidth: ROAD, blockSize: LOT,
    minX: roadX[0] - ROAD / 2, maxX: roadX[roadX.length - 1] + ROAD / 2,
    minZ: roadZ[0] - ROAD / 2, maxZ: roadZ[roadZ.length - 1] + ROAD / 2,
    colliders: [],
    blocks: [],
    parkedSpots: [],
    bins: [],
    lamps: [],
    landmarks: {},
  };
  city.beachZ = city.maxZ + 8;
  city.promenadeZ = city.beachZ + 11;
  city.waterZ = city.beachZ + 46;
  city.pier = { x: -26, z0: city.beachZ, z1: city.waterZ + 62, halfW: 9 };

  // ---------------------------------------------------------------- textures & materials
  const asphaltTex = createAsphaltTexture(seed + 5);
  asphaltTex.repeat.set(1, 1);
  const paveTex = createSidewalkTexture(seed + 7);
  const sandTex = createSandTexture(seed + 9);
  const waterNrm = createWaterNormal(seed + 13);

  const wallVariants = [];
  WALL_COLORS.forEach((wall, i) => {
    const glass = GLASS_TINTS[i % GLASS_TINTS.length];
    wallVariants.push(createFacadeTile(seed + 100 + i, { wall, glass, bays: i % 3 === 0 ? 1 : 2, lit: 0.1 + (i % 5) * 0.03 }));
  });
  const towerTiles = [
    createTowerTile(seed + 200, { spandrel: '#d7d9d2', glass: '#33525f' }),
    createTowerTile(seed + 201, { spandrel: '#c9cdc9', glass: '#2c4a5c' }),
    createTowerTile(seed + 202, { spandrel: '#e0ddd2', glass: '#3d5b56' }),
  ];
  const storeTiles = ACCENTS.map((accent, i) => createStorefrontTile(seed + 300 + i, { accent, bays: 2 }));

  const mkMat = (map) => new THREE.MeshLambertMaterial({ map, vertexColors: true });
  const mats = {
    walls: wallVariants.map((t) => mkMat(t)),
    towers: towerTiles.map((t) => mkMat(t)),
    stores: storeTiles.map((t) => mkMat(t)),
    plain: new THREE.MeshLambertMaterial({ vertexColors: true }),
    ground: new THREE.MeshLambertMaterial({ map: asphaltTex, vertexColors: true }),
    pave: new THREE.MeshLambertMaterial({ map: paveTex, vertexColors: true }),
  };
  const builders = {
    walls: wallVariants.map(() => new MeshBuilder()),
    towers: towerTiles.map(() => new MeshBuilder()),
    stores: storeTiles.map(() => new MeshBuilder()),
    plain: new MeshBuilder(),
    pave: new MeshBuilder(),
    mark: new MeshBuilder(),
  };

  // ---------------------------------------------------------------- ground, sand, sea
  const groundGeo = new THREE.PlaneGeometry(1600, 1600, 1, 1);
  groundGeo.rotateX(-Math.PI / 2);
  // asphalt across the whole map; the uv repeat is set on the texture, not per vertex
  const asphaltWide = asphaltTex.clone();
  asphaltWide.needsUpdate = true;
  asphaltWide.repeat.set(80, 80);
  const ground = new THREE.Mesh(groundGeo, new THREE.MeshLambertMaterial({ map: asphaltWide, color: 0x8e8e96 }));
  ground.receiveShadow = true;
  root.add(ground);
  city.ground = ground;

  const sandMat = new THREE.MeshLambertMaterial({ map: sandTex, color: 0xffffff });
  const sandTexWide = sandTex.clone();
  sandTexWide.needsUpdate = true;
  sandTexWide.repeat.set(50, 10);
  sandMat.map = sandTexWide;
  const sand = new THREE.Mesh(new THREE.PlaneGeometry(1600, 130, 1, 1).rotateX(-Math.PI / 2), sandMat);
  sand.position.set(0, 0.09, city.beachZ + 65);
  sand.receiveShadow = true;
  root.add(sand);

  const waterMat = new THREE.MeshPhongMaterial({
    color: 0x1b6d8e, specular: 0xffd7a0, shininess: 110, normalMap: waterNrm,
    normalScale: new THREE.Vector2(0.55, 0.55), transparent: true, opacity: 0.97,
  });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(2600, 1000, 1, 1).rotateX(-Math.PI / 2), waterMat);
  water.position.set(0, 0.03, city.waterZ + 380);
  root.add(water);
  city.water = water;

  // ---------------------------------------------------------------- wall helper
  /**
   * Adds a wall segment with uvs in tile units so window size is constant in metres. `shop` draws a
   * textured storefront band at the bottom. Each wall is cut into bays so the tile does not stretch.
   */
  function addWall(builder, x0, z0, x1, z1, y0, y1, tint, opts = {}) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const nx = -(z1 - z0) / (len || 1);
    const nz = (x1 - x0) / (len || 1);
    const bays = Math.max(1, Math.round(len / WALL_TILES));
    const shopH = opts.shop ? Math.min(STORE_TILE_H, (y1 - y0) * 0.5) : 0;
    const upperY0 = y0 + shopH;
    for (let i = 0; i < bays; i += 1) {
      const ta = i / bays;
      const tb = (i + 1) / bays;
      const ax = x0 + (x1 - x0) * ta, az = z0 + (z1 - z0) * ta;
      const bx = x0 + (x1 - x0) * tb, bz = z0 + (z1 - z0) * tb;
      const u0 = (len * ta) / WALL_TILES;
      const u1 = (len * tb) / WALL_TILES;
      if (shopH > 0) {
        const sBuilder = opts.storeBuilder;
        const sv1 = shopH / STORE_TILE_H;
        sBuilder.addQuad(
          [ax, y0, az], [ax, y0 + shopH, az], [bx, y0 + shopH, bz], [bx, y0, bz],
          tint, [u0, 0], [u0, sv1], [u1, sv1], [u1, 0], [nx, 0, nz],
        );
      }
      const v0 = (upperY0 - y0) / WALL_TILES;
      const v1 = (y1 - y0) / WALL_TILES;
      builder.addQuad(
        [ax, upperY0, az], [ax, y1, az], [bx, y1, bz], [bx, upperY0, bz],
        tint, [u0, v0], [u0, v1], [u1, v1], [u1, v0], [nx, 0, nz],
      );
    }
  }

  function addBuilding(x, z, w, d, h, palette, opts = {}) {
    const baseY = opts.baseY ?? 0.2;
    const tint = new THREE.Color(opts.tint ?? 0xffffff);
    const wallB = builders.walls[palette.wall % builders.walls.length];
    const towerB = builders.towers[palette.tower % builders.towers.length];
    const builder = opts.tower ? towerB : wallB;
    const storeB = builders.stores[palette.store % builders.stores.length];
    const shop = opts.shop !== false && !opts.tower;
    addWall(builder, x - w / 2, z + d / 2, x + w / 2, z + d / 2, baseY, baseY + h, tint, { shop, storeBuilder: storeB });
    addWall(builder, x + w / 2, z + d / 2, x + w / 2, z - d / 2, baseY, baseY + h, tint, { shop, storeBuilder: storeB });
    addWall(builder, x + w / 2, z - d / 2, x - w / 2, z - d / 2, baseY, baseY + h, tint, { shop, storeBuilder: storeB });
    addWall(builder, x - w / 2, z - d / 2, x - w / 2, z + d / 2, baseY, baseY + h, tint, { shop, storeBuilder: storeB });
    // roof: a slab, a parapet ring, and a slight overhang
    const roof = new THREE.Color(opts.roof ?? 0x9a9083);
    const rb = builders.plain;
    rb.addGround(x - w / 2 - 0.12, z - d / 2 - 0.12, x + w / 2 + 0.12, z + d / 2 + 0.12, baseY + h, roof, [0, 0, 1, 1], 1);
    const par = roof.clone().multiplyScalar(1.06);
    const ph = 0.85;
    rb.addBox(x, baseY + h + ph / 2, z - d / 2 + 0.22, w + 0.2, ph, 0.45, { color: par, faces: 'nesw' });
    rb.addBox(x, baseY + h + ph / 2, z + d / 2 - 0.22, w + 0.2, ph, 0.45, { color: par, faces: 'nesw' });
    rb.addBox(x - w / 2 + 0.22, baseY + h + ph / 2, z, 0.45, ph, d, { color: par, faces: 'nesw' });
    rb.addBox(x + w / 2 - 0.22, baseY + h + ph / 2, z, 0.45, ph, d, { color: par, faces: 'nesw' });
    city.colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, top: baseY + h });
    return baseY + h;
  }

  function addRoofClutter(x, z, w, d, top, tall) {
    const rng2 = rng;
    const n = Math.max(1, Math.min(4, Math.floor((w * d) / 260)));
    for (let i = 0; i < n; i += 1) {
      const cx = x + rng2.range(-w / 2 + 1.8, w / 2 - 1.8);
      const cz = z + rng2.range(-d / 2 + 1.8, d / 2 - 1.8);
      const kind = rng2.next();
      if (kind < 0.4) {
        builders.plain.addBox(cx, top + 0.75, cz, rng2.range(1.1, 2.0), 1.5, rng2.range(1.1, 2.0),
          { color: new THREE.Color(0xa8a298) });
      } else if (kind < 0.68) {
        const rad = rng2.range(0.75, 1.15);
        builders.plain.addCylinder(cx, cz, top, top + 2.2, rad, rad, 7, new THREE.Color(0x9a8a76), { cap: true });
        builders.plain.addCylinder(cx, cz, top + 2.2, top + 2.7, rad * 1.04, rad * 0.5, 7, new THREE.Color(0x7a6c5e), {});
      } else if (kind < 0.86) {
        // stair housing / lift overrun
        builders.plain.addBox(cx, top + 1.1, cz, rng2.range(2, 3.4), 2.2, rng2.range(2, 3), { color: new THREE.Color(0xb0a493) });
      } else {
        builders.plain.addCylinder(cx, cz, top, top + rng2.range(3, 7), 0.1, 0.06, 4, new THREE.Color(0x8a9098), {});
      }
    }
    if (tall > 55) {
      // aircraft warning light and a comms mast: reads instantly as a tower
      builders.plain.addCylinder(x, z, top, top + 9, 0.16, 0.08, 5, new THREE.Color(0x9aa0a6), {});
      builders.plain.addBox(x, top + 9.2, z, 0.3, 0.3, 0.3, { color: new THREE.Color(0xff4a3a) });
    }
  }

  function buildBlock(bx, bz) {
    const distToDowntown = Math.hypot(bx - DOWNTOWN.x, bz - DOWNTOWN.z);
    const block = { x: bx, z: bz, half: LOT / 2, downtown: distToDowntown };
    city.blocks.push(block);
    const inner = LOT - PAVE * 2;
    const x0 = bx - inner / 2;
    const z0 = bz - inner / 2;

    // pavement slab for the whole lot, uvs in metres
    const pb = builders.pave;
    const uvScale = 1 / PAVE_TILE;
    pb.addQuad(
      [bx - LOT / 2, 0.18, bz + LOT / 2], [bx + LOT / 2, 0.18, bz + LOT / 2],
      [bx + LOT / 2, 0.18, bz - LOT / 2], [bx - LOT / 2, 0.18, bz - LOT / 2],
      new THREE.Color(0xffffff),
      [0, 0], [LOT * uvScale, 0], [LOT * uvScale, LOT * uvScale], [0, LOT * uvScale], [0, 1, 0],
    );
    // kerb lip around the lot
    const kerb = new THREE.Color(0xcfc3ad);
    pb.addBox(bx, 0.1, bz - LOT / 2 - 0.22, LOT + 0.44, 0.24, 0.44, { color: kerb, faces: 'nesw' });
    pb.addBox(bx, 0.1, bz + LOT / 2 + 0.22, LOT + 0.44, 0.24, 0.44, { color: kerb, faces: 'nesw' });
    pb.addBox(bx - LOT / 2 - 0.22, 0.1, bz, 0.44, 0.24, LOT + 0.44, { color: kerb, faces: 'nesw' });
    pb.addBox(bx + LOT / 2 + 0.22, 0.1, bz, 0.44, 0.24, LOT + 0.44, { color: kerb, faces: 'nesw' });

    const palette = {
      wall: rng.int(0, WALL_COLORS.length - 1),
      tower: rng.int(0, towerTiles.length - 1),
      store: rng.int(0, storeTiles.length - 1),
      roof: rng.pick([0x9a9083, 0x8a8175, 0xa39a8c, 0x7e766a]),
    };

    const tower = distToDowntown < 120 && rng.chance(0.8);
    const midrise = !tower && distToDowntown < 270 && rng.chance(0.75);

    if (tower) {
      // a podium keeps the street wall, then one or two setbacks above
      const podiumH = rng.range(9, 15);
      addBuilding(bx, bz, inner * 0.9, inner * 0.9, podiumH, { ...palette, wall: rng.int(0, 11), store: rng.int(0, ACCENTS.length - 1) }, { shop: true });
      const w1 = inner * rng.range(0.58, 0.78);
      const d1 = inner * rng.range(0.58, 0.78);
      const h1 = rng.range(30, 78) * (1 - Math.min(0.35, distToDowntown / 420));
      addBuilding(bx, bz, w1, d1, h1, { ...palette, tower: rng.int(0, 2) }, {
        baseY: 0.2 + podiumH, tower: true, shop: false,
        tint: new THREE.Color(0xffffff),
      });
      let top = 0.2 + podiumH + h1;
      if (rng.chance(0.55)) {
        const w2 = w1 * 0.72, d2 = d1 * 0.72;
        const h2 = h1 * rng.range(0.14, 0.3);
        addBuilding(bx, bz, w2, d2, h2, { ...palette, tower: rng.int(0, 2) }, {
          baseY: top, tower: true, shop: false,
        });
        top += h2;
      }
      addRoofClutter(bx, bz, w1 * 0.7, d1 * 0.7, top, h1);
      block.tower = true;
    } else if (midrise) {
      const cols = rng.chance(0.5) ? 2 : 1;
      const rows = rng.chance(0.4) ? 2 : 1;
      const cw = inner / cols;
      const cd = inner / rows;
      for (let cx = 0; cx < cols; cx += 1) {
        for (let cz = 0; cz < rows; cz += 1) {
          const pad = rng.range(0.7, 2.0);
          const w = cw - pad * 2;
          const d = cd - pad * 2;
          const px = x0 + cw * (cx + 0.5);
          const pz = z0 + cd * (cz + 0.5);
          const h = rng.range(13, 30) * (1 - Math.min(0.3, distToDowntown / 700));
          const top = addBuilding(px, pz, w, d, h, { ...palette, wall: rng.int(0, 11), store: rng.int(0, ACCENTS.length - 1) }, {
            tint: new THREE.Color(rng.pick(ACCENTS)).lerp(new THREE.Color(0xffffff), 0.78).getHex(),
            roof: rng.pick([0x9a9083, 0x8a8175, 0xa89c88]),
          });
          if (h > 16) addRoofClutter(px, pz, w, d, top, h);
        }
      }
      block.hasShops = true;
    } else {
      // low-rise beachfront: colourful shopfronts with awnings
      const n = rng.chance(0.5) ? 3 : 2;
      const cw = inner / n;
      for (let i = 0; i < n; i += 1) {
        const pad = rng.range(0.4, 1.2);
        const w = cw - pad * 2;
        const d = inner * rng.range(0.72, 0.94);
        const px = x0 + cw * (i + 0.5);
        const pz = bz + rng.range(-1.2, 2.6);
        const h = rng.range(7.5, 15);
        const accent = rng.pick(ACCENTS);
        const top = addBuilding(px, pz, w, d, h, {
          wall: rng.int(0, 11), store: ACCENTS.indexOf(accent), roof: rng.pick([0xa89c88, 0x9c9182, 0xb0a48f]),
        }, {
          tint: new THREE.Color(accent).lerp(new THREE.Color(0xffffff), 0.7).getHex(),
        });
        // fabric awning over the pavement on the street-facing side
        builders.plain.addBox(px, 3.6, pz + d / 2 + 1.0, w * 0.94, 0.16, 2.0,
          { color: new THREE.Color(accent), faces: 'nsep' });
        // roof terrace rail
        builders.plain.addBox(px, top + 0.5, pz + d / 2 - 0.3, w, 0.9, 0.16, { color: new THREE.Color(0xf0ece2), faces: 'nesw' });
        addRoofClutter(px, pz, w, d, top, h);
      }
    }

    // street furniture: lamp posts and a bin on the kerb, plus street trees handled in foliage
    for (let s = 0; s < 2; s += 1) {
      const side = s === 0 ? -1 : 1;
      const lx = bx + side * (LOT / 2 - 1.1);
      const lz = bz + rng.range(-LOT / 4, LOT / 4);
      city.lamps.push({ x: lx, z: lz });
    }
    if (rng.chance(0.6)) city.bins.push({ x: bx + rng.range(-LOT / 3, LOT / 3), z: bz + LOT / 2 - 1.2 });
  }

  for (let i = 0; i < blocksX; i += 1) {
    for (let j = 0; j < blocksZ; j += 1) {
      const bx = (i - (blocksX - 1) / 2) * PITCH;
      const bz = (j - (blocksZ - 1) / 2) * PITCH;
      buildBlock(bx, bz);
    }
  }

  // ---------------------------------------------------------------- road markings
  const mark = builders.mark;
  const markY = 0.045;
  const white = new THREE.Color(0xd8d4c8);
  const yellow = new THREE.Color(0xd8b862);
  function dash(x0, z0, x1, z1, w, color) {
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len, nz = dx / len;
    mark.addQuad(
      [x0 + nx * w / 2, markY, z0 + nz * w / 2], [x1 + nx * w / 2, markY, z1 + nz * w / 2],
      [x1 - nx * w / 2, markY, z1 - nz * w / 2], [x0 - nx * w / 2, markY, z0 - nz * w / 2],
      color, [0, 0], [1, 0], [1, 1], [0, 1], [0, 1, 0],
    );
  }
  for (const rx of roadX) {
    for (let k = 0; k < roadZ.length - 1; k += 1) {
      const zA = roadZ[k] + ROAD / 2 + 4.5;
      const zB = roadZ[k + 1] - ROAD / 2 - 4.5;
      for (let z = zA; z < zB; z += 8) {
        dash(rx, z, rx, Math.min(z + 4, zB), 0.24, yellow);
        dash(rx - 4.6, z, rx - 4.6, Math.min(z + 4, zB), 0.16, white);
        dash(rx + 4.6, z, rx + 4.6, Math.min(z + 4, zB), 0.16, white);
      }
      dash(rx - ROAD / 2 + 1, zA - 3, rx - 0.4, zA - 3, 0.5, white);
      dash(rx + 0.4, zB + 3, rx + ROAD / 2 - 1, zB + 3, 0.5, white);
    }
  }
  for (const rz of roadZ) {
    for (let k = 0; k < roadX.length - 1; k += 1) {
      const xA = roadX[k] + ROAD / 2 + 4.5;
      const xB = roadX[k + 1] - ROAD / 2 - 4.5;
      for (let x = xA; x < xB; x += 8) {
        dash(x, rz, Math.min(x + 4, xB), rz, 0.24, yellow);
        dash(x, rz - 4.6, Math.min(x + 4, xB), rz - 4.6, 0.16, white);
        dash(x, rz + 4.6, Math.min(x + 4, xB), rz + 4.6, 0.16, white);
      }
      dash(xA - 3, rz - ROAD / 2 + 1, xA - 3, rz - 0.4, 0.5, white);
      dash(xB + 3, rz + 0.4, xB + 3, rz + ROAD / 2 - 1, 0.5, white);
    }
  }
  for (const rx of roadX) {
    for (const rz of roadZ) {
      for (let i = 0; i < 6; i += 1) {
        const o = -ROAD / 2 + 2.0 + i * 2.9;
        dash(rx + o, rz - ROAD / 2 - 3.2, rx + o + 1.4, rz - ROAD / 2 - 3.2, 2.4, white);
        dash(rx + o, rz + ROAD / 2 + 3.2, rx + o + 1.4, rz + ROAD / 2 + 3.2, 2.4, white);
        dash(rx - ROAD / 2 - 3.2, rz + o, rx - ROAD / 2 - 3.2, rz + o + 1.4, 2.4, white);
        dash(rx + ROAD / 2 + 3.2, rz + o, rx + ROAD / 2 + 3.2, rz + o + 1.4, 2.4, white);
      }
    }
  }

  // ---------------------------------------------------------------- promenade, sea wall, pier
  const pave = builders.pave;
  const PAVE_UV = 1 / PAVE_TILE;
  const promWidth = 11;
  const promLen = (city.maxX + 70) * 2;
  pave.addQuad(
    [-city.maxX - 70, 0.19, city.beachZ + promWidth], [city.maxX + 70, 0.19, city.beachZ + promWidth],
    [city.maxX + 70, 0.19, city.beachZ], [-city.maxX - 70, 0.19, city.beachZ],
    new THREE.Color(0xffffff), [0, 0], [promLen * PAVE_UV, 0], [promLen * PAVE_UV, promWidth * PAVE_UV], [0, promWidth * PAVE_UV], [0, 1, 0],
  );
  // sea wall + railing along the promenade
  builders.plain.addBox(0, 0.45, city.beachZ + promWidth, promLen, 0.9, 0.7, { color: new THREE.Color(0xd8ccb4), faces: 'neswp' });
  for (let x = -city.maxX - 60; x < city.maxX + 60; x += 5) {
    builders.plain.addCylinder(x, city.beachZ + promWidth, 0.9, 1.95, 0.07, 0.07, 4, new THREE.Color(0xdad0bc), {});
  }
  builders.plain.addBox(0, 1.9, city.beachZ + promWidth, promLen, 0.12, 0.12, { color: new THREE.Color(0xe4dac6), faces: 'nesw' });
  city.colliders.push({ minX: -city.maxX - 70, maxX: city.maxX + 70, minZ: city.beachZ + promWidth - 0.4, maxZ: city.beachZ + promWidth + 0.4, top: 1.2 });

  // pier deck out over the water
  const pierLen = city.pier.z1 - city.pier.z0;
  builders.plain.addBox(city.pier.x, 0.7, city.pier.z0 + pierLen / 2, city.pier.halfW * 2, 0.5, pierLen, { color: new THREE.Color(0xa08059) });
  for (let z = city.pier.z0; z < city.pier.z1; z += 3.4) {
    builders.plain.addBox(city.pier.x, 0.48, z, city.pier.halfW * 2, 0.26, 0.24, { color: new THREE.Color(0x8b6c4a), faces: 'nsew' });
  }
  for (const side of [-1, 1]) {
    const rx = city.pier.x + side * (city.pier.halfW - 0.4);
    for (let z = city.pier.z0; z <= city.pier.z1; z += 4.2) {
      builders.plain.addCylinder(rx, z, 0.95, 1.55, 0.09, 0.09, 4, new THREE.Color(0xe0d6c2), {});
    }
    builders.plain.addBox(rx, 1.55, city.pier.z0 + pierLen / 2, 0.14, 0.12, pierLen, { color: new THREE.Color(0xe8dfcb), faces: 'nesw' });
  }
  city.pierDeck = { x: city.pier.x, z0: city.pier.z0, z1: city.pier.z1, halfW: city.pier.halfW, y: 0.95 };

  // ---------------------------------------------------------------- signs (original art)
  const signSpots = city.blocks.filter((b) => b.hasShops || b.downtown < 200).slice(0, 12);
  const SIGN_TEXT = [
    ['HOTEL MAREA', 'habitaciones · rooms', '#0f5b6b', '#ffe6a8'],
    ['EL TUCÁN', 'cerveza fría', '#b4342f', '#fff0c8'],
    ['MERCADO SOL', 'frutas del día', '#c9821f', '#3a2410'],
    ['CLUB NEÓN', 'abierto toda la noche', '#5a1f6b', '#ffd0ff'],
    ['TALLER RÍOS', 'mecánica · 24h', '#1f4f7a', '#e8f4ff'],
    ['LA PALMA', 'café cubano', '#2f6b4a', '#fff6d0'],
    ['SALÓN BRISA', 'bailes · salsa', '#8a2f52', '#ffe0ea'],
    ['MIRADOR', 'terraza · vistas', '#2b4f6b', '#ffe9b8'],
    ['PLAYA AZUL', 'alquiler de tablas', '#1d6b78', '#fff0c0'],
    ['TUNA BAR', 'mariscos frescos', '#a8462a', '#fff2d2'],
    ['FARMACIA VELA', 'abierto 24h', '#1d6b3f', '#eaffee'],
    ['GALERÍA ONDA', 'arte local', '#4a3f8a', '#f0e8ff'],
  ];
  signSpots.forEach((block, i) => {
    const [text, sub, bg, fg] = SIGN_TEXT[i % SIGN_TEXT.length];
    const tex = createSignTexture(text, sub, bg, fg);
    const w = rng.range(7.5, 10.5), h = w * 0.26;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex }));
    const side = rng.int(0, 3);
    const off = LOT / 2 - 0.5;
    if (side === 0) { m.position.set(block.x + rng.range(-5, 5), 5.6, block.z - off); m.rotation.y = Math.PI; }
    else if (side === 1) { m.position.set(block.x + rng.range(-5, 5), 5.6, block.z + off); }
    else if (side === 2) { m.position.set(block.x - off, 5.6, block.z + rng.range(-5, 5)); m.rotation.y = -Math.PI / 2; }
    else { m.position.set(block.x + off, 5.6, block.z + rng.range(-5, 5)); m.rotation.y = Math.PI / 2; }
    root.add(m);
  });

  const bladeTex = createBladeTexture('MAREA', '#122a3a', '#ffcf6a');
  for (const dz of [-0.06, 0.06]) {
    const blade = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 11), new THREE.MeshBasicMaterial({ map: bladeTex, side: THREE.DoubleSide }));
    blade.position.set(-38, 17, -34 + dz);
    blade.rotation.y = dz > 0 ? 0 : Math.PI;
    root.add(blade);
  }

  // ---------------------------------------------------------------- build the merged meshes
  function emit(geo, mat, { cast = true, receive = true } = {}) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    root.add(mesh);
    return mesh;
  }
  const wallMeshes = builders.walls.map((b, i) => emit(b.build(), mats.walls[i]));
  const towerMeshes = builders.towers.map((b, i) => emit(b.build(), mats.towers[i]));
  const storeMeshes = builders.stores.map((b, i) => emit(b.build(), mats.stores[i]));
  const plainMesh = emit(builders.plain.build(), mats.plain);
  const paveMesh = emit(builders.pave.build(), mats.pave);
  const markMesh = emit(builders.mark.build(), new THREE.MeshLambertMaterial({
    vertexColors: true, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  }), { cast: false });
  city.meshes = { wallMeshes, towerMeshes, storeMeshes, plainMesh, paveMesh, markMesh };

  // ---------------------------------------------------------------- minimap art
  city.minimap = buildMinimap(city);

  // ---------------------------------------------------------------- gameplay queries
  city.isOnRoad = (x, z) => {
    if (z > city.beachZ) return false;
    for (const rx of roadX) if (Math.abs(x - rx) <= ROAD / 2) return true;
    for (const rz of roadZ) if (Math.abs(z - rz) <= ROAD / 2) return true;
    return false;
  };
  city.isWalkable = (x, z) => z < city.beachZ + 10 && x > city.minX - 30 && x < city.maxX + 30 && z > city.minZ - 30;
  city.nearestRoad = (x, z) => {
    let best = { d: Infinity, x, z, axis: 'x' };
    for (const rx of roadX) {
      const d = Math.abs(x - rx);
      if (d < best.d) best = { d, x: rx, z, axis: 'z' };
    }
    for (const rz of roadZ) {
      const d = Math.abs(z - rz);
      if (d < best.d) best = { d, x, z: rz, axis: 'x' };
    }
    return best;
  };
  city.blockAt = (x, z) => city.blocks.find((b) => Math.abs(x - b.x) < b.half && Math.abs(z - b.z) < b.half) ?? null;
  city.freePoint = (x, z) => !city.colliders.some((c) => x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ);

  // kerbside parking spots, in the lane nearest the kerb
  for (const rz of roadZ) {
    for (let x = city.minX + 16; x < city.maxX - 16; x += 21) {
      if (!rng.chance(0.45)) continue;
      const side = rng.chance(0.5) ? -1 : 1;
      city.parkedSpots.push({
        x: x + rng.range(-3, 3), z: rz + side * (ROAD / 2 - 2.4),
        heading: side > 0 ? -Math.PI / 2 : Math.PI / 2,
      });
    }
  }
  for (const rx of roadX) {
    for (let z = city.minZ + 18; z < city.beachZ - 14; z += 25) {
      if (!rng.chance(0.4)) continue;
      const side = rng.chance(0.5) ? -1 : 1;
      city.parkedSpots.push({
        x: rx + side * (ROAD / 2 - 2.4), z: z + rng.range(-3, 3),
        heading: side > 0 ? 0 : Math.PI,
      });
    }
  }
  // a few spots on the promenade and the pier for the beach scene
  for (let x = -120; x < 150; x += 26) {
    city.parkedSpots.push({ x, z: city.beachZ + 5.4, heading: Math.PI / 2 });
  }

  return city;
}

/**
 * Bakes the static part of the minimap at one world-metre-to-1.5-pixel scale: sea, sand, street
 * grid, block footprints shaded by downtown height, the pier and the beach road. This is drawn once
 * at boot; the HUD rotates and crops it live and lays blips on top.
 */
function buildMinimap(city) {
  const SIZE = 640;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  const spanX = city.maxX - city.minX + 80;
  const spanZ = (city.waterZ + 80) - city.minZ + 80;
  const scale = Math.min(SIZE / spanX, SIZE / spanZ);
  const offX = SIZE / 2 - ((city.minX + city.maxX) / 2) * scale;
  const offZ = SIZE / 2 - ((city.minZ + city.waterZ + 80) / 2) * scale;
  const px = (x) => offX + x * scale;
  const pz = (z) => offZ + z * scale;

  // sea
  ctx.fillStyle = '#123a4c';
  ctx.fillRect(0, 0, SIZE, SIZE);
  // land
  ctx.fillStyle = '#2b3138';
  ctx.fillRect(px(city.minX) - 40, pz(city.minZ) - 40,
    (city.maxX - city.minX) * scale + 80, (city.maxZ - city.minZ) * scale + 80);
  // sand strip
  ctx.fillStyle = '#8a7a54';
  ctx.fillRect(px(city.minX) - 40, pz(city.maxZ),
    (city.maxX - city.minX) * scale + 80, (city.waterZ - city.maxZ) * scale + 2);
  // block footprints, brighter where the towers are so the skyline reads on the radar
  for (const b of city.blocks) {
    const d = 1 - Math.min(1, Math.hypot(b.x - DOWNTOWN.x, b.z - DOWNTOWN.z) / 300);
    const g = Math.round(74 + d * 34);
    ctx.fillStyle = `rgb(${g},${g + 6},${g + 14})`;
    ctx.fillRect(px(b.x - b.half), pz(b.z - b.half), b.half * 2 * scale, b.half * 2 * scale);
  }
  // streets: wide dark strokes with a faint warm centre tint so the grid is unmistakable
  ctx.lineCap = 'butt';
  ctx.strokeStyle = '#15191e';
  ctx.lineWidth = Math.max(3, city.roadWidth * scale);
  for (const rx of city.roadX) {
    ctx.beginPath(); ctx.moveTo(px(rx), pz(city.minZ) - 30); ctx.lineTo(px(rx), pz(city.beachZ) + 30); ctx.stroke();
  }
  for (const rz of city.roadZ) {
    ctx.beginPath(); ctx.moveTo(px(city.minX) - 30, pz(rz)); ctx.lineTo(px(city.maxX) + 30, pz(rz)); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(226,198,140,0.30)';
  ctx.lineWidth = 1;
  for (const rx of city.roadX) {
    ctx.beginPath(); ctx.moveTo(px(rx), pz(city.minZ)); ctx.lineTo(px(rx), pz(city.beachZ)); ctx.stroke();
  }
  for (const rz of city.roadZ) {
    ctx.beginPath(); ctx.moveTo(px(city.minX), pz(rz)); ctx.lineTo(px(city.maxX), pz(rz)); ctx.stroke();
  }
  // pier
  ctx.fillStyle = '#5b4a33';
  ctx.fillRect(px(city.pier.x - city.pier.halfW), pz(city.pier.z0),
    city.pier.halfW * 2 * scale, (city.pier.z1 - city.pier.z0) * scale);

  return { canvas, scale, offX, offZ, px, pz, size: SIZE };
}
