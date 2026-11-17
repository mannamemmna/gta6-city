// Cars: original models built from an extruded silhouette plus wheels, lights and glass. A car has
// a body group that leans and a wheel set that spins and steers, so it reads as a vehicle rather
// than a box. The same class serves parked cars, traffic, police cruisers and the player's ride;
// only `spec` and the paint colour differ.
import * as THREE from 'three';
import { VEHICLE } from './config.js';

const MODEL_SPECS = {
  sabueso: {  // 90s coupe: low, long bonnet
    name: 'SABUESO GT', len: 4.5, wid: 1.94, height: 1.16, cabin: 1.9, cabinU: 0.34,
    nose: 0.62, tail: 0.5, roof: 0.52, wheelR: 0.34, wheelbase: 2.6, mass: 1.0, top: 36, color: 0xd94f3d,
  },
  burro: {    // boxy SUV
    name: 'BURRO 4X4', len: 4.7, wid: 2.02, height: 1.62, cabin: 2.5, cabinU: 0.3,
    nose: 0.42, tail: 0.32, roof: 0.42, wheelR: 0.4, wheelbase: 2.75, mass: 1.25, top: 30, color: 0x3f5f4a,
  },
  gaviota: {  // long convertible
    name: 'GAVIOTA', len: 5.0, wid: 1.9, height: 1.02, cabin: 1.5, cabinU: 0.36,
    nose: 0.72, tail: 0.62, roof: 0.28, wheelR: 0.33, wheelbase: 2.95, mass: 1.05, top: 34, color: 0xe8d9b0,
    open: true,
  },
  taxico: {   // little hatch taxi
    name: 'TAXICO', len: 4.2, wid: 1.8, height: 1.45, cabin: 2.2, cabinU: 0.26,
    nose: 0.4, tail: 0.34, roof: 0.44, wheelR: 0.32, wheelbase: 2.45, mass: 0.92, top: 28, color: 0xe8b53d,
  },
  furgon: {   // panel van
    name: 'FURGÓN', len: 5.2, wid: 2.06, height: 2.1, cabin: 3.4, cabinU: 0.2,
    nose: 0.3, tail: 0.22, roof: 0.3, wheelR: 0.38, wheelbase: 3.0, mass: 1.4, top: 25, color: 0xc9c3b0,
  },
  patrulla: { // police cruiser
    name: 'PATRULLA', len: 4.6, wid: 1.96, height: 1.44, cabin: 2.1, cabinU: 0.28,
    nose: 0.46, tail: 0.4, roof: 0.42, wheelR: 0.34, wheelbase: 2.7, mass: 1.1, top: 34, color: 0xf2efe6,
    police: true,
  },
};

export const CAR_MODELS = Object.keys(MODEL_SPECS);

function makeWheel(radius, width) {
  const g = new THREE.Group();
  const tyre = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, width, 12),
    new THREE.MeshLambertMaterial({ color: 0x1a1c20 }),
  );
  tyre.rotation.z = Math.PI / 2;
  g.add(tyre);
  const rim = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.58, radius * 0.58, width + 0.02, 8),
    new THREE.MeshLambertMaterial({ color: 0xb9bcc2 }),
  );
  rim.rotation.z = Math.PI / 2;
  g.add(rim);
  return g;
}

/** Builds the visual car. Origin at the centre of the wheelbase, +Z forward. */
function buildCarMesh(spec, color, opts = {}) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const L = spec.len, W = spec.wid, H = spec.height;
  const paint = new THREE.MeshLambertMaterial({ color });
  const darkTrim = new THREE.MeshLambertMaterial({ color: 0x22262c });
  const glass = new THREE.MeshLambertMaterial({ color: 0x1d2b33, transparent: true, opacity: 0.78 });

  // main body: a slightly tapered box, lower sill and a shoulder line
  const lower = new THREE.Mesh(new THREE.BoxGeometry(W, H * 0.52, L), paint);
  lower.position.y = spec.wheelR + H * 0.2;
  body.add(lower);

  // bonnet / boot wedge shapes (tapered by scaling the top face)
  const bonnet = new THREE.Mesh(new THREE.BoxGeometry(W * 0.96, H * 0.24, L * spec.nose * 0.62), paint);
  bonnet.position.set(0, spec.wheelR + H * 0.48, L * (0.5 - spec.nose * 0.32));
  body.add(bonnet);
  const boot = new THREE.Mesh(new THREE.BoxGeometry(W * 0.96, H * 0.26, L * spec.tail * 0.55), paint);
  boot.position.set(0, spec.wheelR + H * 0.48, -L * (0.5 - spec.tail * 0.3));
  body.add(boot);

  // cabin: a solid, tapered greenhouse — sides in paint, glass insets on each face, and a roof
  // panel — so the car never shows a hollow black box where the roof should be.
  const cabinLen = L * spec.cabin / 5;
  const cabinZ = L * (0.5 - spec.cabinU) - cabinLen / 2;
  const cabinH = spec.roof;
  const cabinY = spec.wheelR + H * 0.44 + cabinH * 0.5;
  const cog = new THREE.Group();
  cog.position.set(0, cabinY, cabinZ);
  body.add(cog);
  const cw = W * 0.86;
  // painted pillars: front, back, and both side rails, all thinner than the glass they frame
  const pillarMat = paint;
  const roofPanel = new THREE.Mesh(new THREE.BoxGeometry(cw, 0.1, cabinLen), spec.open ? darkTrim : pillarMat);
  roofPanel.position.y = cabinH * 0.5 - 0.03;
  if (!spec.open) cog.add(roofPanel);
  const sideGlassL = new THREE.Mesh(new THREE.BoxGeometry(0.06, cabinH * 0.72, cabinLen * 0.94), glass);
  sideGlassL.position.set(-cw / 2, -cabinH * 0.06, 0);
  cog.add(sideGlassL);
  const sideGlassR = sideGlassL.clone();
  sideGlassR.position.x = cw / 2;
  cog.add(sideGlassR);
  // side paint below the glass so the doors read as bodywork, not glass
  for (const side of [-1, 1]) {
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.1, cabinH * 0.42, cabinLen * 0.96), pillarMat);
    door.position.set(side * cw / 2, -cabinH * 0.26, 0);
    cog.add(door);
    // A/B/C pillars
    for (const zz of [-cabinLen / 2 + 0.05, cabinLen / 2 - 0.05]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.1, cabinH * 0.78, 0.12), pillarMat);
      pillar.position.set(side * cw / 2, -cabinH * 0.04, zz);
      cog.add(pillar);
    }
  }
  const shield = new THREE.Mesh(new THREE.BoxGeometry(cw * 0.94, cabinH * 0.66, 0.07), glass);
  shield.position.set(0, -cabinH * 0.04, cabinLen / 2 + 0.01);
  shield.rotation.x = -0.28;
  cog.add(shield);
  const rearGlass = new THREE.Mesh(new THREE.BoxGeometry(cw * 0.9, cabinH * 0.6, 0.07), glass);
  rearGlass.position.set(0, -cabinH * 0.05, -cabinLen / 2 - 0.01);
  rearGlass.rotation.x = 0.3;
  cog.add(rearGlass);

  // bumpers, grille, lights
  const bumperF = new THREE.Mesh(new THREE.BoxGeometry(W * 0.98, 0.16, 0.22), darkTrim);
  bumperF.position.set(0, spec.wheelR + 0.04, L / 2 - 0.04);
  body.add(bumperF);
  const bumperB = bumperF.clone();
  bumperB.position.z = -L / 2 + 0.04;
  body.add(bumperB);

  const lightMat = new THREE.MeshBasicMaterial({ color: 0xfff0c8 });
  for (const side of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(W * 0.24, 0.13, 0.08), lightMat);
    hl.position.set(side * W * 0.31, spec.wheelR + H * 0.34, L / 2 + 0.01);
    body.add(hl);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(W * 0.22, 0.12, 0.06),
      new THREE.MeshBasicMaterial({ color: 0xd8322c }));
    tl.position.set(side * W * 0.32, spec.wheelR + H * 0.34, -L / 2 - 0.01);
    body.add(tl);
  }
  const grille = new THREE.Mesh(new THREE.BoxGeometry(W * 0.5, 0.14, 0.06), darkTrim);
  grille.position.set(0, spec.wheelR + H * 0.3, L / 2 + 0.03);
  body.add(grille);

  // wheels: two steerable front, two rear
  const wheels = [];
  const wx = W / 2 - 0.06;
  const wz = spec.wheelbase / 2;
  for (const [sx, sz, steer] of [[-1, 1, true], [1, 1, true], [-1, -1, false], [1, -1, false]]) {
    const holder = new THREE.Group();
    holder.position.set(sx * wx, spec.wheelR, sz * wz);
    const wheel = makeWheel(spec.wheelR, 0.24);
    holder.add(wheel);
    root.add(holder);
    wheels.push({ holder, wheel, steer });
  }

  // police kit: roof bar, door decal band, push bar
  const extra = {};
  if (spec.police || opts.police) {
    const barBase = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.1, 0.28), darkTrim);
    barBase.position.set(0, spec.wheelR + H * 0.44 + spec.roof * 0.98, cabinZ);
    body.add(barBase);
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.14, 0.24), new THREE.MeshBasicMaterial({ color: 0xff2a2a }));
    red.position.set(-0.3, spec.wheelR + H * 0.44 + spec.roof * 1.12, cabinZ);
    body.add(red);
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.14, 0.24), new THREE.MeshBasicMaterial({ color: 0x2a6bff }));
    blue.position.set(0.3, spec.wheelR + H * 0.44 + spec.roof * 1.12, cabinZ);
    body.add(blue);
    extra.red = red;
    extra.blue = blue;
    const band = new THREE.Mesh(new THREE.BoxGeometry(W + 0.02, 0.22, L * 0.5), new THREE.MeshLambertMaterial({ color: 0x1c2f52 }));
    band.position.set(0, spec.wheelR + H * 0.26, -0.1);
    body.add(band);
    const push = new THREE.Mesh(new THREE.BoxGeometry(W * 0.7, 0.3, 0.12), darkTrim);
    push.position.set(0, spec.wheelR + 0.05, L / 2 + 0.1);
    body.add(push);
  }
  if (opts.taxi) {
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.2, 0.24), new THREE.MeshBasicMaterial({ color: 0xffe9a8 }));
    sign.position.set(0, spec.wheelR + H * 0.44 + spec.roof * 1.0, cabinZ);
    body.add(sign);
  }
  // soft shadow patch under the car so it grounds on the road even in shadow
  const blob = new THREE.Mesh(
    new THREE.PlaneGeometry(W * 1.15, L * 1.05),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.24, depthWrite: false }),
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.03;
  root.add(blob);

  root.traverse((o) => { if (o.isMesh && o !== blob) { o.castShadow = true; } });
  return { root, body, wheels, extra, spec };
}

export class Car {
  constructor(model, opts = {}) {
    const spec = MODEL_SPECS[model] ?? MODEL_SPECS.sabueso;
    this.model = model;
    this.spec = spec;
    this.color = opts.color ?? spec.color;
    this.mesh = buildCarMesh(spec, this.color, opts);
    this.group = this.mesh.root;
    this.body = this.mesh.body;
    this.wheels = this.mesh.wheels;
    this.extra = this.mesh.extra;
    this.police = !!(spec.police || opts.police);

    this.x = opts.x ?? 0;
    this.z = opts.z ?? 0;
    this.y = opts.y ?? 0;
    this.heading = opts.heading ?? 0;
    this.speed = 0;
    this.steer = 0;
    this.lean = 0;
    this.pitch = 0;
    this.wheelSpin = 0;
    this.throttle = 0;
    this.brakeLight = false;
    this.honk = 0;
    this.occupant = null;      // who is driving (player, cop, traffic)
    this.ai = opts.ai ?? null; // 'traffic' | 'police' | 'chase' | 'parked'
    this.health = opts.health ?? 100;
    this.burning = 0;
    this.wheelBase = spec.wheelbase;
    this.halfLen = spec.len / 2;
    this.halfWid = spec.wid / 2;
    this.applyToMesh();
  }

  get speedKmh() { return Math.abs(this.speed) * 3.6; }

  /** Distance from a point to the car's oriented rectangle, used for collisions and prompts. */
  distanceTo(x, z) {
    const dx = x - this.x;
    const dz = z - this.z;
    const c = Math.cos(-this.heading), s = Math.sin(-this.heading);
    const lx = dx * c - dz * s;
    const lz = dx * s + dz * c;
    return { lateral: lx, longitudinal: lz, dist: Math.hypot(dx, dz) };
  }

  applyToMesh() {
    this.group.position.set(this.x, this.y, this.z);
    this.group.rotation.y = this.heading;
    this.body.rotation.z = this.lean;
    this.body.rotation.x = this.pitch;
  }

  updateVisual(dt) {
    this.wheelSpin -= (this.speed * dt) / this.spec.wheelR;
    for (const w of this.wheels) {
      w.wheel.rotation.x = this.wheelSpin;
      if (w.steer) w.holder.rotation.y = this.steer * 0.5;
    }
    const targetLean = -this.steer * Math.min(0.09, Math.abs(this.speed) / 320);
    this.lean += (targetLean - this.lean) * Math.min(1, dt * 7);
    const targetPitch = this.throttle * -0.026 + (this.brakeLight ? 0.03 : 0);
    this.pitch += (targetPitch - this.pitch) * Math.min(1, dt * 5);
    if (this.extra.red) {
      const t = performance.now() / 1000;
      const blink = Math.sin(t * 9) > 0;
      this.extra.red.visible = blink;
      this.extra.blue.visible = !blink;
    }
    this.applyToMesh();
  }

  /** Player-driven arcade physics: throttle -1..1, steer -1..1 (positive = right). */
  drive(dt, throttle, steer, handbrake) {
    const spec = this.spec;
    const top = spec.top;
    const accel = VEHICLE.accel * (1 - Math.min(1, Math.abs(this.speed) / (top * 1.15))) * (spec.mass > 1.2 ? 0.86 : 1);
    this.throttle = throttle;
    if (throttle > 0.02) {
      this.speed += accel * throttle * dt;
    } else if (throttle < -0.02) {
      if (this.speed > 0.4) this.speed -= VEHICLE.brake * dt;
      else this.speed += accel * throttle * 0.5 * dt;
    } else {
      this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), VEHICLE.drag * dt * 7);
    }
    if (handbrake) this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), 18 * dt);
    this.speed = Math.max(-VEHICLE.reverseSpeed, Math.min(top, this.speed));
    this.brakeLight = throttle < -0.02 || handbrake;

    const steerFactor = Math.min(1, Math.abs(this.speed) / 9);
    this.steer += (steer - this.steer) * Math.min(1, dt * 9);
    const turn = this.steer * VEHICLE.steerRate * steerFactor * Math.sign(this.speed || 1);
    this.heading -= turn * dt * (handbrake ? 1.5 : 1);

    const fx = Math.sin(this.heading) * this.speed * dt;
    const fz = Math.cos(this.heading) * this.speed * dt;
    this.x += fx;
    this.z += fz;
    return { dx: fx, dz: fz };
  }

  /** Pushes the car out of a building box and bleeds speed if it hit. */
  resolveBoxes(colliders) {
    let hit = false;
    const r = this.halfWid;
    for (const c of colliders) {
      if (c.isWater) continue;
      const nx = Math.max(c.minX, Math.min(this.x, c.maxX));
      const nz = Math.max(c.minZ, Math.min(this.z, c.maxZ));
      const dx = this.x - nx, dz = this.z - nz;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        const d = Math.sqrt(d2) || 0.001;
        const push = r - d;
        this.x += (dx / d) * push;
        this.z += (dz / d) * push;
        hit = true;
      }
    }
    if (hit) this.speed *= 0.28;
    return hit;
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); }
    });
  }
}

export { MODEL_SPECS, buildCarMesh };
