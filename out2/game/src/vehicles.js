// Vehicles: a light arcade model with a steering bicycle, grip that slides, handbrake
// drifts, and circle-vs-building collision that dents your speed. Cars can be
// stolen, driven, rammed and shot; the AI drives the same class through a simple
// waypoint follower.

import { VEHICLES, COP, CITY } from './config.js';
import { angleDelta, clamp, damp } from './math3d.js';
import { drawVehicle, drawCarShadow, vehicleSpec } from './models.js';

let nextId = 1;

export class Vehicle {
  constructor(world, spec, x, z, yaw = 0) {
    this.world = world;
    this.spec = spec;
    this.id = nextId++;
    this.x = x; this.z = z;
    this.y = world.groundAt(x, z);
    this.yaw = yaw;
    this.vx = 0; this.vz = 0;
    this.speed = 0;
    this.steer = 0;
    this.angular = 0;
    this.color = spec.body;
    this.driver = null;      // 'player' | 'ai' | null
    this.ai = null;
    this.health = 100;
    this.onFire = 0;
    this.siren = Math.random() * 6;
    this.honkTimer = 0;
    this.braking = false;
    this.driftAmount = 0;
    this.wheelSpin = 0;
    this.stuck = 0;
    this.occupied = false;
    this.parked = false;
    this.dead = false;
  }

  get pos() { return [this.x, this.y, this.z]; }
  get heading() { return { x: -Math.sin(this.yaw), z: Math.cos(this.yaw) }; }
  get forwardSpeed() {
    const h = this.heading;
    return this.vx * h.x + this.vz * h.z;
  }

  eject() {
    if (this.driver === 'player') this.driver = null;
  }

  update(dt, controls, world) {
    if (this.dead) return;
    const spec = this.spec;
    const ctl = controls ?? {};
    const throttle = ctl.throttle ?? 0;
    const steerInput = ctl.steer ?? 0;
    const handbrake = !!ctl.handbrake;
    const brake = !!ctl.brake;

    const maxSteer = 0.58 - Math.min(0.28, Math.abs(this.forwardSpeed) / (spec.top * 2.6));
    this.steer = damp(this.steer, steerInput * maxSteer, 8, dt);

    const fwd = this.heading;
    let fs = this.vx * fwd.x + this.vz * fwd.z;
    let ls = this.vx * -fwd.z + this.vz * fwd.x;

    // engine and brakes
    const accel = spec.accel * (1 - Math.min(0.88, Math.abs(fs) / spec.top));
    fs += throttle * accel * dt;
    if (brake) fs -= Math.sign(fs) * Math.min(Math.abs(fs), 26 * dt);
    if (handbrake) fs -= Math.sign(fs) * Math.min(Math.abs(fs), 14 * dt);
    // drag and rolling resistance
    fs *= 1 - Math.min(0.9, (0.55 + Math.abs(fs) * 0.012) * dt);
    if (!throttle && !brake) fs = damp(fs, 0, 0.6, dt);
    fs = clamp(fs, -spec.top * 0.35, spec.top);

    // lateral grip: less when the handbrake is down, and it slides at speed
    const gripLoss = handbrake ? 0.92 : 0.70;
    const lat = ls * Math.exp(-spec.grip * (handbrake ? 1.6 : 6.2) * dt);
    this.driftAmount = damp(this.driftAmount, Math.min(1, Math.abs(ls) / 8), 4, dt);
    ls = lat;

    // yaw from the steered front wheels
    const turn = this.steer * fs * 0.052 * (handbrake ? 1.35 : 1);
    this.yaw += turn * dt;
    this.braking = brake || handbrake;
    this.wheelSpin += fs * dt * 2.4;

    // rebuild world velocity in the new heading
    const nf = this.heading;
    this.vx = nf.x * fs - nf.z * ls;
    this.vz = nf.z * fs + nf.x * ls;
    this.speed = Math.hypot(this.vx, this.vz);

    const nx = this.x + this.vx * dt;
    const nz = this.z + this.vz * dt;

    // collide as a circle, then push back along the normal
    const r = spec.wid * 0.62;
    const [rx, rz] = world.colliders.resolve(nx, nz, r);
    if (Math.abs(rx - nx) > 1e-5 || Math.abs(rz - nz) > 1e-5) {
      const impact = this.speed;
      this.x = rx; this.z = rz;
      this.vx *= 0.14; this.vz *= 0.14;
      if (impact > 9) {
        this.health -= (impact - 9) * 0.55;
        world.addSpark(rx, this.y + 0.7, rz, Math.min(10, Math.round(impact * 0.4)), [1.0, 0.75, 0.35]);
        if (this.health <= 0) this.explode(world);
      }
    } else {
      this.x = nx; this.z = nz;
    }

    // the sea stops you
    const g = world.groundAt(this.x, this.z);
    if (g < world.waterY - 0.3) {
      this.x -= this.vx * dt; this.z -= this.vz * dt;
      this.vx *= 0.2; this.vz *= 0.2;
    }
    this.y = Math.max(world.groundAt(this.x, this.z), -0.2);

    if (this.health < 35 && Math.random() < dt * 6) {
      world.addSpark(this.x + (Math.random() - 0.5) * 2, this.y + 1.0, this.z + (Math.random() - 0.5) * 2, 1, [0.6, 0.6, 0.64]);
    }
  }

  explode(world) {
    this.dead = true;
    this.driver = null;
    world.addSpark(this.x, this.y + 1, this.z, 40, [1.0, 0.55, 0.2]);
    world.addDecal(this.x, this.z, 3.2, [0.08, 0.07, 0.06], 40);
    this.health = 0;
  }

  draw(buf, opts = {}) {
    drawCarShadow(buf, this);
    drawVehicle(buf, this, {
      lightsOn: opts.lightsOn ?? false,
      brake: this.braking || (this.speed < 0.4 && this.driver),
      sirenPhase: this.siren,
      driver: this.driver !== null || this.parked,
      driverShirt: this.ai?.shirt,
    });
  }

  serialize() {
    return { id: this.spec.id, x: this.x, z: this.z, yaw: this.yaw, health: this.health };
  }
}

// --------------------------------------------------------------------- spawner

const TRAFFIC_KINDS = ['marisol', 'tern', 'cormorant', 'barracuda', 'pelican', 'manatee', 'skua', 'petrel', 'osprey'];

export function spawnTraffic(world, count = 22, rng = Math.random) {
  const cars = [];
  const nodes = world.city.nodes.flat();
  for (let i = 0; i < count; i++) {
    const node = nodes[Math.floor(rng() * nodes.length)];
    const link = node.links[Math.floor(rng() * node.links.length)];
    if (!link) continue;
    const t = 0.35 + rng() * 0.3;
    const x = node.x + (link.x - node.x) * t;
    const z = node.z + (link.z - node.z) * t;
    // drive on the right of the line
    const dx = link.x - node.x, dz = link.z - node.z;
    const len = Math.hypot(dx, dz) || 1;
    const rx = dx / len, rz = dz / len;
    const off = CITY.road * 0.22;
    const yaw = Math.atan2(-rx, rz);
    const specId = TRAFFIC_KINDS[Math.floor(rng() * TRAFFIC_KINDS.length)];
    const spec = vehicleSpec(specId);
    const car = new Vehicle(world, spec, x + rx * 0 + rz * off, z + rz * 0 - rx * off, yaw);
    car.lane = { from: node, to: link, t: 0.5, dir: 1 };
    car.ai = { kind: 'traffic', waitTimer: 0, targetSpeed: 8 + rng() * 6, shirt: [0.3, 0.3, 0.34] };
    car.parked = false;
    cars.push(car);
  }
  return cars;
}

export function spawnParked(world, rng) {
  const cars = [];
  const B = CITY;
  for (const block of world.city.blocks) {
    if (rng() > 0.55) continue;
    const n = 1 + Math.floor(rng() * 3);
    for (let k = 0; k < n; k++) {
      const side = rng() < 0.5 ? -1 : 1;
      const specId = TRAFFIC_KINDS[Math.floor(rng() * TRAFFIC_KINDS.length)];
      const spec = vehicleSpec(specId);
      const along = 8 + rng() * (block.side - 16);
      const x = block.x - block.side / 2 - B.road * 0.30;
      const z = block.z - block.side / 2 + along;
      const car = new Vehicle(world, spec, x + (rng() - 0.5) * 2, z, Math.PI / 2 * (rng() < 0.5 ? 1 : -1));
      car.parked = true;
      car.health = 60 + rng() * 40;
      cars.push(car);
    }
  }
  return cars;
}

export { vehicleSpec, VEHICLES, COP };
