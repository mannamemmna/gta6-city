// The player on foot: camera-relative WASD movement, sprint, jump, a simple collision push out of
// buildings, and the bridge to and from a car (enter/exit, so driving hands control to vehicles.js).
// Marisol's look is fixed: red jacket, dark trousers, long dark hair.
import * as THREE from 'three';
import { PLAYER } from './config.js';
import { Humanoid } from './humanoid.js';

export class Player {
  constructor(city, opts = {}) {
    this.city = city;
    this.rig = new Humanoid({
      skin: 0xc08a62, shirt: 0xd1402f, pants: 0x24303c, hair: 0x1a1210, longHair: true,
      shoes: 0xe8e2d0, random: () => 0.5, scale: 1.0,
    });
    this.group = this.rig.group;
    this.x = opts.x ?? 0;
    this.z = opts.z ?? 0;
    this.y = 0;
    this.vy = 0;
    this.heading = opts.heading ?? Math.PI;
    this.speed = 0;
    this.health = PLAYER.health;
    this.armor = 0;
    this.money = 500;
    this.ammo = 34;
    this.ammoReserve = 96;
    this.car = null;
    this.targetSpeed = 0;
    this.aiming = false;
    this.firing = 0;
    this.recoil = 0;
    this.hurtFlash = 0;
    this.footstepT = 0;
    this.state = 'idle';
    this.dying = false;
    this.dead = false;
  }

  get position() { return { x: this.x, y: this.y, z: this.z }; }

  place(x, z, heading = this.heading) {
    this.x = x;
    this.z = z;
    this.heading = heading;
    this.y = 0;
    this.vy = 0;
    this.rig.rig.rotation.x = 0;
    this.rig.rig.position.y = 0;
    this.rig.group.rotation.set(0, heading, 0);
    this.sync();
  }

  sync() {
    this.rig.group.position.set(this.x, this.y, this.z);
    this.rig.group.rotation.y = this.heading;
  }

  /** Camera-relative movement. Returns true while walking on a solid surface. */
  move(dt, cameraYaw, input, blocked) {
    this.aiming = input.aiming;
    const ax = input.strafe;
    const af = input.forward;
    let wantX = 0, wantZ = 0;
    if (ax || af) {
      const fwdX = Math.sin(cameraYaw), fwdZ = Math.cos(cameraYaw);
      const rightX = Math.cos(cameraYaw), rightZ = -Math.sin(cameraYaw);
      wantX = fwdX * af + rightX * ax;
      wantZ = fwdZ * af + rightZ * ax;
      const len = Math.hypot(wantX, wantZ) || 1;
      wantX /= len; wantZ /= len;
    }
    const sprint = input.sprint && !this.aiming;
    const base = this.aiming ? PLAYER.walkSpeed * 0.68 : (sprint ? PLAYER.sprintSpeed : PLAYER.runSpeed);
    const target = (ax || af) ? base : 0;
    this.targetSpeed = target;
    this.speed += (target - this.speed) * Math.min(1, dt * (target > this.speed ? 9 : 12));

    if (this.speed > 0.05) {
      const heading = Math.atan2(wantX, wantZ);
      this.heading = lerpAngle(this.heading, heading, Math.min(1, dt * 12));
      this.x += wantX * this.speed * dt;
      this.z += wantZ * this.speed * dt;
    }
    // gravity and jump
    if (input.jump && this.y <= 0.001) {
      this.vy = PLAYER.jumpSpeed;
      input.jump = false;
    }
    this.vy += PLAYER.gravity * dt;
    this.y += this.vy * dt;
    if (this.y < 0) { this.y = 0; this.vy = 0; }

    resolveCircle(this, this.city.colliders, PLAYER.radius);
    this.sync();
    const moving = this.speed > 0.4;
    this.rig.update(dt, moving ? this.speed : 0, { aiming: this.aiming });
    this.state = this.aiming ? 'aim' : moving ? (sprint ? 'run' : 'walk') : 'idle';

    if (moving) {
      this.footstepT -= dt * this.speed;
      if (this.footstepT <= 0) {
        this.footstepT = 2.1;
        return 'step';
      }
    }
    return null;
  }

  hurt(amount) {
    if (this.dead) return;
    const absorbed = Math.min(this.armor, amount * 0.6);
    this.armor -= absorbed;
    this.health -= amount - absorbed;
    this.hurtFlash = 1;
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      this.rig.die();
    }
  }

  heal(n) { this.health = Math.min(PLAYER.health, this.health + n); }

  /** Where the muzzle is, in world space, for firing and for the tracer origin. */
  muzzle() {
    const c = Math.cos(this.heading), s = Math.sin(this.heading);
    return {
      x: this.x + s * 0.72 + c * 0.24,
      y: this.y + 1.28,
      z: this.z + c * 0.72 - s * 0.24,
    };
  }

  eye() { return { x: this.x, y: this.y + 1.62, z: this.z }; }
}

/** Pushes a circle (actor) out of axis-aligned building boxes, sliding along the wall. */
export function resolveCircle(actor, colliders, radius) {
  for (const c of colliders) {
    if (c.isWater) continue;
    if (actor.y > (c.top ?? 99) - 0.1) continue;
    const nx = Math.max(c.minX, Math.min(actor.x, c.maxX));
    const nz = Math.max(c.minZ, Math.min(actor.z, c.maxZ));
    const dx = actor.x - nx;
    const dz = actor.z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 < radius * radius) {
      const d = Math.sqrt(d2);
      if (d < 0.0001) {
        // dead centre: push out on the nearest axis
        const left = Math.abs(actor.x - c.minX);
        const right = Math.abs(c.maxX - actor.x);
        const near = Math.abs(actor.z - c.minZ);
        const far = Math.abs(c.maxZ - actor.z);
        const m = Math.min(left, right, near, far);
        if (m === left) actor.x = c.minX - radius;
        else if (m === right) actor.x = c.maxX + radius;
        else if (m === near) actor.z = c.minZ - radius;
        else actor.z = c.maxZ + radius;
      } else {
        const push = radius - d;
        actor.x += (dx / d) * push;
        actor.z += (dz / d) * push;
      }
    }
  }
}

export function lerpAngle(a, b, t) {
  let diff = ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return a + diff * t;
}

export { THREE };
