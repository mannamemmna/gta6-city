// Every character and vehicle in Cobalt Bay is built from the same handful of
// boxes and cylinders. This module owns those silhouettes: a person with a walk
// cycle, an aim pose and a body for the pavement, and nine car kinds with glass,
// lights, wheels and plates.

import { VEHICLES, COP } from './config.js';

const MAT = { LIT: 0, GLOW: 1, LEAF: 3, FLAT: 4, GLASS: 5 };

const GLASS = [0.16, 0.22, 0.26];
const RUBBER = [0.055, 0.055, 0.06];
const TRIM = [0.14, 0.15, 0.17];
const PLATE = [0.86, 0.88, 0.84];
const HEADLIGHT = [1.0, 0.94, 0.74];
const TAILLIGHT = [0.86, 0.12, 0.10];

export function headingVec(yaw) {
  return { x: -Math.sin(yaw), z: Math.cos(yaw) };
}
export function yawFromDir(dx, dz) {
  return Math.atan2(-dx, dz);
}
// rotate a local offset into the world
export function localToWorld(lx, lz, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [lx * c - lz * s, lx * s + lz * c];
}

// ---------------------------------------------------------------- characters

const PERSON = {
  hip: 0.90,
  torso: 0.62,
  head: 0.24,
  shoulder: 0.44,
  legW: 0.20,
};

export function drawPerson(buf, p) {
  const { x, y, z, yaw } = p;
  // contact shadow so nobody floats on the pavement
  if (!p.noShadow) {
    const rad = p.down ? 1.0 : 0.52;
    buf.push(x, y + 0.022, z, rad * 2.1, 0.012, rad * 2.1, yaw, [0.05, 0.06, 0.08], MAT.FLAT);
  }
  const skin = p.skin ?? [0.90, 0.74, 0.58];
  const shirt = p.shirt ?? [0.80, 0.40, 0.30];
  const pants = p.pants ?? [0.20, 0.25, 0.30];
  const hair = p.hair ?? [0.14, 0.10, 0.08];
  const phase = p.phase ?? 0;
  const moving = p.moving ?? 0;
  const swing = Math.sin(phase * 7.5) * 0.9 * moving;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const put = (lx, ly, lz, w, h, d, col, mat = MAT.LIT) =>
    buf.push(x + lx * c - lz * s, y + ly, z + lx * s + lz * c, w, h, d, yaw, col, mat);

  if (p.down) {
    // face down on the pavement
    buf.push(x, y + 0.06, z, 0.55, 0.28, 1.85, yaw, shirt, MAT.LIT);
    buf.push(x - 0.06 * c, y + 0.06, z - 0.06 * s, 0.42, 0.30, 0.30, yaw, skin, MAT.LIT);
    return;
  }

  const hipY = PERSON.hip + (p.crouch ? -0.22 : 0);
  const lean = p.aim ? 0.10 : 0.03 + 0.05 * moving;

  // legs
  const legSwing = p.seated ? 0.28 : swing * 0.42;
  for (const side of [-1, 1]) {
    const sw = legSwing * side;
    const lzF = p.seated ? 0.34 : Math.sin(sw) * 0.30;
    const lzB = p.seated ? -0.10 : -Math.sin(sw) * 0.30;
    put(side * 0.11, 0, lzF, PERSON.legW, hipY * 0.98, PERSON.legW, pants);
    put(side * 0.11, 0, lzB, PERSON.legW * 0.98, hipY * 0.5, PERSON.legW, pants);
    // shoe
    put(side * 0.11, 0, lzF + 0.04, PERSON.legW + 0.02, 0.11, 0.34, TRIM);
  }

  // torso, tapered by two stacked boxes
  put(0, hipY, 0, PERSON.shoulder, PERSON.torso * 0.55, 0.26, shirt);
  put(0, hipY + PERSON.torso * 0.55, 0, PERSON.shoulder * 1.04, PERSON.torso * 0.45, 0.28, shirt);

  // neck + head
  put(0, hipY + PERSON.torso, 0.02, 0.13, 0.09, 0.13, skin);
  put(0, hipY + PERSON.torso + 0.30, 0.02, 0.235, 0.235, 0.235, skin);
  // hair cap, and a few styles
  if (p.hat) {
    put(0, hipY + PERSON.torso + 0.53, 0.02, 0.30, 0.06, 0.32, p.hat);
    put(0, hipY + PERSON.torso + 0.57, 0.10, 0.24, 0.10, 0.22, p.hat);
  } else {
    put(0, hipY + PERSON.torso + 0.50, -0.01, 0.245, 0.10, 0.245, hair);
  }

  // arms
  const armSwing = p.aim ? 0 : swing * 0.55;
  for (const side of [-1, 1]) {
    if (p.aim && side === 1) {
      // gun arm forward, raised
      put(0.16, hipY + PERSON.torso * 0.78, 0.16, 0.13, 0.13, 0.52, shirt);
      put(0.14, hipY + PERSON.torso * 0.78, 0.42, 0.11, 0.11, 0.14, skin);
      if (p.gun) {
        put(0.14, hipY + PERSON.torso * 0.80, 0.52, 0.07, 0.07, 0.30, [0.10, 0.10, 0.12]);
      }
    } else if (p.aim && side === -1) {
      put(-0.13, hipY + PERSON.torso * 0.74, 0.20, 0.12, 0.12, 0.40, shirt);
    } else {
      const as = Math.sin(armSwing * side + Math.PI) * 0.24;
      put(side * 0.24, hipY + PERSON.torso * 0.62, as, 0.115, PERSON.torso * 0.62, 0.115, shirt);
      put(side * 0.24, hipY + PERSON.torso * 0.18, as + 0.02, 0.105, 0.16, 0.105, skin);
    }
  }

  if (p.armed && !p.aim) {
    put(0.10, hipY + 0.04, 0.22, 0.07, 0.16, 0.24, [0.11, 0.11, 0.13]);
  }
}

// ------------------------------------------------------------------- vehicles

const CAR_CACHE = new Map();
export function vehicleSpec(id) {
  if (id === 'warden') return COP.car;
  if (!CAR_CACHE.size) for (const v of VEHICLES) CAR_CACHE.set(v.id, v);
  return CAR_CACHE.get(id) ?? VEHICLES[0];
}

export function drawVehicle(buf, car, opts = {}) {
  const spec = car.spec;
  const yaw = car.yaw;
  const x = car.x, y = car.y ?? 0, z = car.z;
  const L = spec.len, W = spec.wid, H = spec.hgt;
  const body = car.color ?? spec.body;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const put = (lx, ly, lz, w, h, d, col, mat = MAT.LIT, spin = 0) => {
    const wx = x + lx * c - lz * s;
    const wz = z + lx * s + lz * c;
    buf.push(wx, y + ly, wz, w, h, d, yaw, col, mat);
  };

  const wheelR = spec.kind === 'truck' || spec.kind === 'van' ? 0.42 : spec.kind === 'sport' ? 0.32 : 0.36;
  const sillY = wheelR * 0.72;
  const dark = [body[0] * 0.55, body[1] * 0.55, body[2] * 0.55];

  // chassis
  put(0, sillY, 0, W * 0.96, 0.34, L * 0.98, dark);
  // main body
  put(0, sillY + 0.34, 0, W, H * 0.42, L * 0.96, body);

  if (spec.kind === 'van' || spec.kind === 'truck') {
    // tall cargo box behind the cab
    const cargoStart = -L * 0.04;
    put(0, sillY + 0.34, -L * 0.16, W * 1.01, H * 0.86, L * 0.66, body);
    // door line
    put(0, sillY + 0.40, -L * 0.02, W * 1.02, H * 0.80, 0.08, dark);
    // cab
    put(0, sillY + 0.34, L * 0.30, W * 0.96, H * 0.52, L * 0.30, body);
    put(0, sillY + 0.50, L * 0.455, W * 0.86, H * 0.34, 0.10, GLASS, MAT.GLASS);
    put(0, sillY + H * 0.52, L * 0.30, W * 0.94, 0.10, L * 0.34, dark);
  } else if (spec.kind === 'pickup') {
    // cabin forward, open bed aft
    put(0, sillY + 0.34 + H * 0.24, L * 0.06, W * 0.90, H * 0.44, L * 0.44, GLASS, MAT.GLASS);
    put(0, sillY + 0.34 + H * 0.52, L * 0.04, W * 0.96, 0.12, L * 0.50, body);
    // bed walls
    put(-W * 0.47, sillY + 0.34, -L * 0.26, 0.10, 0.52, L * 0.42, body);
    put(W * 0.47, sillY + 0.34, -L * 0.26, 0.10, 0.52, L * 0.42, body);
    put(0, sillY + 0.34, -L * 0.46, W, 0.52, 0.10, body);
  } else {
    // coupe / sedan / hatch / muscle / sport / police
    const roofStart = spec.kind === 'hatch' ? 0.02 : spec.kind === 'sport' ? -0.02 : 0.04;
    const roofLen = spec.kind === 'hatch' ? 0.46 : spec.kind === 'sport' ? 0.36 : 0.40;
    const cabinH = H * 0.36;
    const cabinInset = spec.kind === 'sport' ? 0.86 : 0.88;
    put(0, sillY + 0.34 + cabinH * 0.5, L * (roofStart - 0.06), W * cabinInset, cabinH, L * roofLen, GLASS, MAT.GLASS);
    // roof
    put(0, sillY + 0.34 + cabinH, L * (roofStart - 0.06), W * cabinInset * 0.98, 0.10, L * (roofLen - 0.10), body);
    // A and C pillars
    put(-W * 0.42, sillY + 0.34, L * (roofStart + roofLen * 0.5 - 0.10), 0.09, cabinH, 0.10, dark);
    put(W * 0.42, sillY + 0.34, L * (roofStart + roofLen * 0.5 - 0.10), 0.09, cabinH, 0.10, dark);
    put(-W * 0.42, sillY + 0.34, L * (roofStart - 0.06 - roofLen * 0.5 + 0.10), 0.09, cabinH, 0.12, dark);
    put(W * 0.42, sillY + 0.34, L * (roofStart - 0.06 - roofLen * 0.5 + 0.10), 0.09, cabinH, 0.12, dark);
    // hood and boot
    put(0, sillY + 0.34 + 0.06, L * 0.34, W * 0.94, 0.10, L * 0.22, body);
    put(0, sillY + 0.34 + 0.06, -L * 0.36, W * 0.94, 0.10, L * 0.18, body);
    // wheel arches
    for (const sx of [-1, 1]) {
      put(sx * W * 0.48, sillY + 0.10, L * 0.30, 0.06, 0.30, 0.60, dark);
      put(sx * W * 0.48, sillY + 0.10, -L * 0.30, 0.06, 0.30, 0.60, dark);
    }
  }

  // wheels
  const wx = W * 0.5 - 0.02;
  const wheelLift = wheelR;
  for (const sx of [-1, 1]) {
    for (const sz of [L * 0.31, -L * 0.31]) {
      const wob = 0;
      const px = x + sx * wx * c - sz * s;
      const pz = z + sx * wx * s + sz * c;
      buf.push(px, y - wheelR, pz, W * 0.16, wheelR * 2, wheelR * 2, yaw, RUBBER, MAT.LIT);
      buf.push(px + 0.001 * sx * c, y - wheelR * 0.55, pz + 0.001 * sx * s, W * 0.17, wheelR * 0.9, wheelR * 0.9, yaw, [0.56, 0.57, 0.58], MAT.LIT);
    }
  }

  // lights
  const noseZ = L * 0.49;
  for (const sx of [-1, 1]) {
    put(sx * W * 0.34, sillY + 0.42, noseZ, W * 0.22, 0.16, 0.06, opts.lightsOn ? HEADLIGHT : [0.80, 0.80, 0.74], opts.lightsOn ? MAT.GLOW : MAT.LIT);
    put(sx * W * 0.34, sillY + 0.42, -noseZ, W * 0.22, 0.14, 0.06, opts.brake ? [1.0, 0.16, 0.12] : TAILLIGHT, opts.brake ? MAT.GLOW : MAT.LIT);
  }
  // plate
  put(0, sillY + 0.30, -noseZ - 0.03, 0.44, 0.14, 0.03, PLATE, MAT.FLAT);
  put(0, sillY + 0.22, L * 0.50, 0.40, 0.12, 0.02, PLATE, MAT.FLAT);

  if (spec.police) {
    // livery: a dark band with a door badge
    put(0, sillY + 0.40, 0, W * 1.005, 0.24, L * 0.72, [0.10, 0.13, 0.22]);
    put(0, sillY + 0.40, 0, W * 1.01, 0.10, L * 0.74, [0.90, 0.86, 0.70]);
    // light bar
    const barY = sillY + 0.34 + H * 0.36 + 0.14;
    const flash = opts.sirenPhase ?? 0;
    const redOn = Math.sin(flash) > 0;
    put(-W * 0.20, barY, L * 0.02, W * 0.34, 0.16, 0.30, redOn ? [1.0, 0.16, 0.12] : [0.32, 0.10, 0.10], redOn ? MAT.GLOW : MAT.LIT);
    put(W * 0.20, barY, L * 0.02, W * 0.34, 0.16, 0.30, !redOn ? [0.20, 0.42, 1.0] : [0.10, 0.14, 0.34], !redOn ? MAT.GLOW : MAT.LIT);
    // push bar
    put(0, sillY + 0.16, L * 0.52, W * 0.70, 0.34, 0.10, [0.20, 0.21, 0.22]);
  }

  // driver silhouette
  if (opts.driver !== false) {
    const seat = spec.kind === 'van' || spec.kind === 'truck' ? L * 0.26 : L * 0.02;
    put(-0.34, sillY + 0.34 + H * 0.16, seat, 0.34, 0.34, 0.30, opts.driverShirt ?? [0.20, 0.22, 0.26]);
    put(-0.34, sillY + 0.34 + H * 0.30, seat + 0.02, 0.24, 0.26, 0.24, opts.driverSkin ?? [0.84, 0.68, 0.52]);
    put(-0.34, sillY + 0.34 + H * 0.42, seat + 0.01, 0.25, 0.08, 0.26, [0.12, 0.10, 0.08]);
  }
}

export function drawCarShadow(buf, car) {
  const spec = car.spec;
  // two overlapping dark quads: a body shadow and a soft core under the wheels
  buf.push(car.x, (car.y ?? 0) + 0.016, car.z, spec.wid * 1.16, 0.012, spec.len * 1.08, car.yaw, [0.045, 0.05, 0.07], MAT.FLAT);
  buf.push(car.x, (car.y ?? 0) + 0.020, car.z, spec.wid * 0.86, 0.012, spec.len * 0.78, car.yaw, [0.02, 0.02, 0.03], MAT.FLAT);
}
