// Traffic and AI driving. Cars follow the city's node graph, keep to the right,
// stop for whatever is in front of them, and lean on the horn when blocked. The
// same steering routine carries a police cruiser when it is chasing.

import { CITY } from './config.js';
import { angleDelta, clamp, damp } from './math3d.js';

// Lane offset from the centre line so every car hugs its right-hand side.
export function laneOffset(v) {
  const side = v.lane?.dir ?? 1;
  return CITY.road * 0.22 * side;
}

export function driveTo(world, car, target, dt, opts = {}) {
  const dx = target.x - car.x;
  const dz = target.z - car.z;
  const want = Math.atan2(-dx, dz);
  const diff = angleDelta(car.yaw, want);
  const dist = Math.hypot(dx, dz);
  const maxSteer = Math.min(1, Math.abs(diff) / 0.6);
  const steer = clamp(diff * 1.9, -1, 1) * maxSteer;
  const speedWant = opts.speed ?? 12;
  const slowForTurn = 1 - Math.min(0.62, Math.abs(diff) * 0.5);
  const targetSpeed = speedWant * slowForTurn * clamp(dist / 14, 0.35, 1);
  const fs = car.forwardSpeed;
  let throttle = 0, brake = false;
  if (fs < targetSpeed) throttle = clamp((targetSpeed - fs) / 6, 0, 1);
  else if (fs > targetSpeed + 1.5) brake = true;
  return { throttle, steer, brake, handbrake: opts.handbrake ?? false, diff, dist };
}

export class Traffic {
  constructor(world, vehicles, rng) {
    this.world = world;
    this.vehicles = vehicles;
    this.rng = rng;
    this.despawnAt = 320;
  }

  update(dt, game) {
    const player = game.player;
    for (const car of this.vehicles) {
      if (!car.ai) continue;
      if (car.driver === 'player') continue;
      if (car.ai.kind === 'traffic') this.updateTraffic(car, dt, player);
      else if (car.ai.kind === 'flee') this.updateFlee(car, dt, player, game);
      else if (car.ai.kind === 'chase') this.updateChase(car, dt, player, game);
      else if (car.ai.kind === 'escort') this.updateEscort(car, dt, game);
    }
  }

  updateTraffic(car, dt, player) {
    const lane = car.lane;
    if (!lane) { car.ai.kind = 'idle'; return; }
    const from = lane.from, to = lane.to;
    const len = Math.hypot(to.x - from.x, to.z - from.z) || 1;
    const dirx = (to.x - from.x) / len, dirz = (to.z - from.z) / len;
    // lane point on the right side of travel
    const offx = -dirz * CITY.road * 0.22;
    const offz = dirx * CITY.road * 0.22;
    const tx = to.x + offx, tz = to.z + offz;
    // have we reached the intersection?
    const dTo = Math.hypot(tx - car.x, tz - car.z);
    // look ahead for something in the way
    const h = car.heading;
    let blocked = false;
    const probeDist = 5 + Math.abs(car.forwardSpeed) * 0.55;
    for (const other of this.vehicles) {
      if (other === car || other.dead) continue;
      const ox = other.x - car.x, oz = other.z - car.z;
      const along = ox * h.x + oz * h.z;
      const side = Math.abs(ox * -h.z + oz * h.x);
      if (along > 0 && along < probeDist + other.spec.len * 0.5 && side < other.spec.wid * 0.75) {
        if (car.forwardSpeed > other.forwardSpeed - 1) blocked = true;
      }
    }
    const pdx = player.x - car.x, pdz = player.z - car.z;
    const pAlong = pdx * h.x + pdz * h.z;
    const pSide = Math.abs(pdx * -h.z + pdz * h.x);
    if (!player.vehicle && pAlong > 0 && pAlong < 4.5 && pSide < 1.6) blocked = true;

    let controls;
    if (blocked) {
      car.honkTimer -= dt;
      if (car.honkTimer <= 0) { car.honkTimer = 2.5 + this.rng() * 3; car.honk = 0.7; }
      controls = { throttle: 0, brake: true, steer: 0 };
    } else {
      controls = driveTo(this.world, car, { x: tx, z: tz }, dt, { speed: car.ai.targetSpeed });
      // small lane wander so the street doesn't look ruled
      car.laneWander = car.laneWander ?? (this.rng() - 0.5) * 1.1;
    }
    car.update(dt, controls, this.world);

    if (dTo < 6.5) {
      // choose a heading at the intersection that isn't a U-turn
      const opts = to.links.filter((n) => n !== from);
      const next = opts.length
        ? (this.rng() < 0.72 && opts.find((n) => n.i === to.i + Math.sign(to.i - from.i) || n.j === to.j + Math.sign(to.j - from.j)))
          ?? opts[Math.floor(this.rng() * opts.length)]
        : from;
      car.lane = { from: to, to: next, dir: 1 };
    }

    // keep the traffic around the player
    const dp = Math.hypot(car.x - player.x, car.z - player.z);
    if (dp > this.despawnAt && car.lane) {
      const nodes = this.world.city.nodes.flat();
      const near = nodes.filter((n) => {
        const d = Math.hypot(n.x - player.x, n.z - player.z);
        return d < 120 && d > 60;
      });
      if (near.length) {
        const n = near[Math.floor(this.rng() * near.length)];
        const l = n.links[Math.floor(this.rng() * n.links.length)];
        const t = 0.4 + this.rng() * 0.2;
        car.x = n.x + (l.x - n.x) * t;
        car.z = n.z + (l.z - n.z) * t;
        car.yaw = Math.atan2(-(l.x - n.x), (l.z - n.z));
        car.vx = 0; car.vz = 0;
        car.lane = { from: n, to: l, dir: 1 };
      }
    }
  }

  updateFlee(car, dt, player, game) {
    // a civilian panicking at speed: drive fast away from the player
    const ax = car.x - player.x, az = car.z - player.z;
    const d = Math.hypot(ax, az) || 1;
    const ahead = { x: car.x + (ax / d) * 40, z: car.z + (az / d) * 40 };
    // check the road ahead: if a building is there, steer along the street
    const wall = this.world.colliders.hits(ahead.x, ahead.z, 2);
    let tgt = ahead;
    if (wall) {
      const h = car.heading;
      tgt = { x: car.x + h.x * 30 - h.z * 12, z: car.z + h.z * 30 + h.x * 12 };
    }
    const controls = driveTo(this.world, car, tgt, dt, { speed: 26 });
    controls.throttle = Math.max(controls.throttle, 0.85);
    car.update(dt, controls, this.world);
  }

  updateChase(car, dt, player, game) {
    // police: aim for a point on the player's tail, ram if close
    const target = player.vehicle
      ? { x: player.vehicle.x, z: player.vehicle.z }
      : { x: player.x, z: player.z };
    const d = Math.hypot(target.x - car.x, target.z - car.z);
    const pv = player.vehicle;
    const lead = pv ? 0.35 + Math.min(1.0, d * 0.02) : 0;
    const speed = game.police?.chaseSpeed ?? 30;
    const controls = driveTo(this.world, car, target, dt, { speed: d < 25 ? speed * 0.9 : speed });
    if (d < 8) { controls.throttle = 0.1; controls.brake = true; }
    car.update(dt, controls, this.world);
    car.siren += dt * 7.5;
    // ram damage
    if (pv && d < pv.spec.len * 0.6 + car.spec.len * 0.6 && Math.abs(car.forwardSpeed) > 8) {
      const rel = Math.abs(car.forwardSpeed - pv.forwardSpeed);
      if (rel > 4) {
        game.onRam(car, pv);
      }
    }
  }

  updateEscort(car, dt, game) {
    const t = car.ai.waypoints;
    if (!t || !t.length) { car.update(dt, { throttle: 0, brake: true }, this.world); return; }
    const wp = t[0];
    const d = Math.hypot(wp.x - car.x, wp.z - car.z);
    if (d < 7) { t.shift(); return; }
    const controls = driveTo(this.world, car, wp, dt, { speed: car.ai.speed ?? 16 });
    car.update(dt, controls, this.world);
  }
}
