// Pedestrians: a crowd that walks the pavement ring of each block, crosses at
// corners, panics when shots land or a car bears down on them, and can be knocked
// flying. Bodies leave a chalk outline for a while.

import { CITY, PEDS } from './config.js';
import { angleDelta, clamp, damp } from './math3d.js';
import { drawPerson } from './models.js';
import { pick, range } from './rng.js';

export class Pedestrian {
  constructor(world, rng, x, z, block) {
    this.world = world;
    this.x = x; this.z = z;
    this.y = world.groundAt(x, z);
    this.rng = rng;
    this.block = block;
    this.radius = PEDS.radius;
    this.speed = PEDS.walk * range(rng, 0.82, 1.24);
    this.yaw = rng() * Math.PI * 2;
    this.shirt = hex(pick(rng, PEDS.shirts));
    this.pants = hex(pick(rng, PEDS.pants));
    this.skin = hex(pick(rng, PEDS.skin));
    this.hair = hex(pick(rng, PEDS.hair));
    this.hat = rng() < 0.16 ? hex(pick(rng, PEDS.pants)) : null;
    this.phase = rng() * 10;
    this.moving = 1;
    this.state = 'walk';
    this.timer = 0;
    this.health = 40;
    this.dead = false;
    this.fleeing = 0;
    this.target = null;
    this.talk = 0;
    this.witness = false;
    // pick a pavement waypoint
    this.pickWaypoint();
  }

  pickWaypoint() {
    const b = this.block;
    if (!b) {
      this.target = { x: this.x + range(this.rng, -20, 20), z: this.z + range(this.rng, -20, 20) };
      return;
    }
    const edge = Math.floor(this.rng() * 4);
    const inset = 2.2;
    const lo = -b.side / 2 + 5, hi = b.side / 2 - 5;
    const a = range(this.rng, lo, hi);
    if (edge === 0) this.target = { x: b.x + a, z: b.z - b.side / 2 + inset };
    else if (edge === 1) this.target = { x: b.x + a, z: b.z + b.side / 2 - inset };
    else if (edge === 2) this.target = { x: b.x - b.side / 2 + inset, z: b.z + a };
    else this.target = { x: b.x + b.side / 2 - inset, z: b.z + a };
  }

  scare(source, duration = 4) {
    this.fleeing = Math.max(this.fleeing, duration);
    this.fleeFrom = { x: source.x, z: source.z };
    this.state = 'flee';
  }

  hurt(amount, dir, world) {
    this.health -= amount;
    if (this.health <= 0) {
      this.dead = true;
      this.state = 'down';
      world.addDecal(this.x, this.z, 1.1, [0.36, 0.05, 0.06], 30);
      world.addFloater(this.x, this.y + 1.4, this.z, '-', [0.9, 0.3, 0.3]);
      return true;
    }
    this.scare(this.fleeFrom ?? this, 6);
    return false;
  }

  update(dt, game) {
    if (this.dead) return;
    this.timer += dt;
    if (this.fleeing > 0) this.fleeing -= dt;
    const player = game.player;

    // panic if the player is shooting nearby or a car is charging
    const dpx = player.x - this.x, dpz = player.z - this.z;
    const dp = Math.hypot(dpx, dpz);
    if (game.alarmLevel > 0.05 && dp < 26 && this.fleeing <= 0 && this.rng() < 0.02) {
      this.scare(player, 5);
    }
    if (this.fleeing > 0 && this.fleeing < 0.1) this.state = 'walk';

    let tx = this.target.x, tz = this.target.z;
    let speed = this.speed;
    if (this.state === 'flee') {
      const away = Math.atan2(this.x - (this.fleeFrom?.x ?? player.x), this.z - (this.fleeFrom?.z ?? player.z));
      tx = this.x + Math.sin(away) * 12;
      tz = this.z + Math.cos(away) * 12;
      speed = PEDS.run;
    }

    const dx = tx - this.x, dz = tz - this.z;
    const d = Math.hypot(dx, dz);
    if (d < 1.1) {
      if (this.state === 'flee') { this.pickWaypoint(); }
      else { this.pickWaypoint(); this.timer = 0; }
    }
    const want = Math.atan2(-dx, dz);
    this.yaw += angleDelta(this.yaw, want) * Math.min(1, dt * 7);

    const step = speed * dt;
    let nx = this.x - Math.sin(this.yaw) * step;
    let nz = this.z + Math.cos(this.yaw) * step;

    // avoid the player's body and the car if one is close
    const [rx, rz] = this.world.colliders.resolve(nx, nz, this.radius);
    if (Math.abs(rx - nx) > 0.001 || Math.abs(rz - nz) > 0.001) {
      // slid along a wall: pick a fresh heading
      if (this.rng() < 0.06) this.pickWaypoint();
    }
    nx = rx; nz = rz;

    // step out of the player's way
    if (dp < 1.0 && dp > 0.01) {
      nx += (dpx / dp) * (1.0 - dp);
      nz += (dpz / dp) * (1.0 - dp);
    }

    this.x = nx; this.z = nz;
    this.y = this.world.groundAt(this.x, this.z);
    this.moving = damp(this.moving, this.state === 'flee' ? 1.5 : 0.8, 6, dt);
    this.phase += dt * (0.6 + this.moving * 1.4);

    // don't swim
    if (this.world.isWater(this.x, this.z)) {
      this.x -= -Math.sin(this.yaw) * step;
      this.z -= Math.cos(this.yaw) * step;
      this.pickWaypoint();
    }

    // react to traffic
    for (const v of game.vehicles) {
      const ddx = v.x - this.x, ddz = v.z - this.z;
      const dd = Math.hypot(ddx, ddz);
      if (dd < 6.5 && v.speed > 7 && this.fleeing <= 0) {
        this.scare(v, 2.4);
      }
      if (dd < (v.spec.wid * 0.7 + 0.5) && v.speed > 3) {
        // clipped by a car
        this.hurt(60, v, this.world);
        this.x += (this.x - v.x) * 0.4;
        this.z += (this.z - v.z) * 0.4;
      }
    }
  }

  draw(buf) {
    drawPerson(buf, {
      x: this.x, y: this.y, z: this.z, yaw: this.yaw,
      shirt: this.shirt, pants: this.pants, skin: this.skin, hair: this.hair,
      hat: this.hat, phase: this.phase, moving: this.moving, down: this.dead,
      aim: false, gun: false,
    });
  }
}

export function spawnCrowd(world, rng) {
  const peds = [];
  const blocks = world.city.blocks;
  let tries = 0;
  while (peds.length < PEDS.count && tries < PEDS.count * 8) {
    tries++;
    const b = blocks[Math.floor(rng() * blocks.length)];
    const edge = Math.floor(rng() * 4);
    const inset = 2.0;
    const lo = -b.side / 2 + 5, hi = b.side / 2 - 5;
    const a = range(rng, lo, hi);
    let x, z;
    if (edge === 0) { x = b.x + a; z = b.z - b.side / 2 + inset; }
    else if (edge === 1) { x = b.x + a; z = b.z + b.side / 2 - inset; }
    else if (edge === 2) { x = b.x - b.side / 2 + inset; z = b.z + a; }
    else { x = b.x + b.side / 2 - inset; z = b.z + a; }
    peds.push(new Pedestrian(world, rng, x, z, b));
  }
  return peds;
}

function hex(v) {
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}
