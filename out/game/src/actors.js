// Mission opposition: armed guards and casino bagmen. They use the same person
// silhouette as the crowd but carry guns, take cover behind the nearest box, and
// fire at the player when they have a line.

import { angleDelta, clamp, damp } from './math3d.js';
import { drawPerson } from './models.js';

export class Guard {
  constructor(world, x, z, kind = 'ferro', rng = Math.random) {
    this.world = world;
    this.x = x; this.z = z;
    this.y = world.groundAt(x, z);
    this.yaw = rng() * Math.PI * 2;
    this.kind = kind;
    this.health = kind === 'trust' ? 110 : 85;
    this.dead = false;
    this.fireTimer = 0.8 + rng() * 1.4;
    this.phase = 0;
    this.moving = 0;
    this.aim = true;
    this.down = false;
    this.radius = 0.38;
    const palette = {
      ferro: { shirt: [0.28, 0.24, 0.20], pants: [0.14, 0.14, 0.16], skin: [0.74, 0.57, 0.42], hair: [0.10, 0.09, 0.08] },
      harbour: { shirt: [0.16, 0.28, 0.34], pants: [0.16, 0.18, 0.22], skin: [0.86, 0.70, 0.54], hair: [0.22, 0.16, 0.10] },
      city: { shirt: [0.12, 0.14, 0.20], pants: [0.10, 0.11, 0.15], skin: [0.66, 0.48, 0.34], hair: [0.08, 0.07, 0.06] },
      trust: { shirt: [0.18, 0.20, 0.26], pants: [0.12, 0.13, 0.17], skin: [0.90, 0.76, 0.62], hair: [0.30, 0.24, 0.16] },
    }[kind] ?? { shirt: [0.3, 0.3, 0.3], pants: [0.2, 0.2, 0.2], skin: [0.8, 0.6, 0.45], hair: [0.1, 0.1, 0.1] };
    Object.assign(this, palette);
    this.home = { x, z };
  }

  hurt(amount, dir, world) {
    this.health -= amount;
    if (this.health <= 0 && !this.dead) {
      this.dead = true;
      world.addDecal(this.x, this.z, 1.0, [0.32, 0.05, 0.05], 26);
      return true;
    }
    return false;
  }

  update(dt, game) {
    if (this.dead) return;
    const p = game.player;
    const px = p.vehicle ? p.vehicle.x : p.x;
    const pz = p.vehicle ? p.vehicle.z : p.z;
    const dx = px - this.x, dz = pz - this.z;
    const d = Math.hypot(dx, dz) || 1;
    this.yaw += angleDelta(this.yaw, Math.atan2(-dx, dz)) * Math.min(1, dt * 7);
    this.aim = d < 46;

    // hold a ring around their post, backing off when the player closes in
    let step = 0;
    const want = 13;
    if (d > want + 3) step = 3.2 * dt;
    else if (d < want - 5) step = -2.4 * dt;
    if (step) {
      const nx = this.x + (dx / d) * step;
      const nz = this.z + (dz / d) * step;
      const [rx, rz] = this.world.colliders.resolve(nx, nz, this.radius);
      this.x = rx; this.z = rz;
      this.y = this.world.groundAt(rx, rz);
    }
    this.moving = damp(this.moving, Math.abs(step) > 0.0005 ? 1 : 0, 6, dt);
    this.phase += dt * (0.7 + this.moving * 1.8);

    this.fireTimer -= dt;
    if (d < 44 && this.fireTimer <= 0 && this.aim) {
      this.fireTimer = 0.85 + Math.random() * 1.1;
      game.combat.officerShot(this, { x: px, z: pz }, 2);
    }
  }

  draw(buf) {
    drawPerson(buf, {
      x: this.x, y: this.y, z: this.z, yaw: this.yaw,
      shirt: this.shirt, pants: this.pants, skin: this.skin, hair: this.hair,
      phase: this.phase, moving: this.moving, aim: this.aim && !this.dead,
      gun: true, armed: true, down: this.dead,
    });
  }
}

// The casino bagmen: they run, not fight, but they carry the bags you came for.
export class Bagman {
  constructor(world, x, z) {
    this.world = world;
    this.x = x; this.z = z;
    this.y = world.groundAt(x, z);
    this.yaw = Math.random() * 6.28;
    this.health = 60;
    this.dead = false;
    this.phase = 0;
    this.moving = 1;
    this.aim = false;
    this.bag = true;
    this.radius = 0.38;
    this.shirt = [0.92, 0.90, 0.84];
    this.pants = [0.12, 0.13, 0.16];
    this.skin = [0.80, 0.62, 0.46];
    this.hair = [0.12, 0.10, 0.08];
  }

  hurt(amount, dir, world) {
    this.health -= amount;
    if (this.health <= 0 && !this.dead) {
      this.dead = true;
      world.addDecal(this.x, this.z, 1.2, [0.30, 0.05, 0.05], 30);
      world.addFloater(this.x, this.y + 1.6, this.z, 'BAG', [1, 0.85, 0.35]);
      return true;
    }
    return false;
  }

  update(dt, game) {
    if (this.dead) return;
    const p = game.player;
    const dx = this.x - p.x, dz = this.z - p.z;
    const d = Math.hypot(dx, dz) || 1;
    if (d < 0.9) { this.x += (dx / d) * 0.4; this.z += (dz / d) * 0.4; }
    // bolt for the nearest door / away from the player
    if (d < 22) {
      const nx = this.x + (dx / d) * 5.2 * dt;
      const nz = this.z + (dz / d) * 5.2 * dt;
      const [rx, rz] = this.world.colliders.resolve(nx, nz, this.radius);
      this.x = rx; this.z = rz;
      this.y = this.world.groundAt(rx, rz);
      this.yaw = Math.atan2(-dx, dz);
      this.moving = 1.6;
    } else this.moving = 0.3;
    this.phase += dt * (0.8 + this.moving);
  }

  draw(buf) {
    drawPerson(buf, {
      x: this.x, y: this.y, z: this.z, yaw: this.yaw,
      shirt: this.shirt, pants: this.pants, skin: this.skin, hair: this.hair,
      phase: this.phase, moving: this.moving, aim: false, gun: false, down: this.dead,
    });
    if (!this.dead) buf.push(this.x + 0.28, this.y + 0.95, this.z + 0.10, 0.34, 0.30, 0.20, this.yaw, [0.72, 0.62, 0.36], 0);
  }
}
