// The chase camera. On foot it orbits behind the player and eases in when you aim;
// in a car it hangs back and low, widens with speed and swings out on a drift.
// Both keep the lens above ground and outside buildings.

import { V3, angleDelta, clamp, damp } from './math3d.js';

const UP = [0, 1, 0];

export class Camera {
  constructor() {
    this.pos = [0, 12, 30];
    this.target = [0, 2, 0];
    this.yaw = Math.PI;
    this.pitch = -0.16;
    this.fov = 1.02;
    this.shake = 0;
    this.mode = 'foot';
    this.distance = 5.2;
    this.desired = [0, 0, 0];
    this.snap = true;
  }

  reset() { this.snap = true; }

  look(dx, dy, sensitivity) {
    this.yaw -= dx * sensitivity;
    this.pitch = clamp(this.pitch - dy * sensitivity * 0.85, -0.85, 0.55);
  }

  update(dt, subject, world, opts = {}) {
    const aiming = opts.aiming;
    const inCar = opts.vehicle;
    const speed = opts.speed ?? 0;

    let back, height, lookAhead, sideOffset = 0;
    if (inCar) {
      back = 7.4 + Math.min(4.6, speed * 0.13);
      height = 2.9 + Math.min(0.9, speed * 0.02);
      lookAhead = 9 + speed * 0.14;
      // swing wide when the car is sliding
      sideOffset = clamp((opts.drift ?? 0) * 0.9, -2.2, 2.2);
      this.fov = damp(this.fov, 1.02 + Math.min(0.26, speed * 0.0042), 3, dt);
    } else if (aiming) {
      back = 2.2;
      height = 1.62;
      lookAhead = 0.4;
      this.fov = damp(this.fov, 0.88, 7, dt);
    } else {
      back = 5.0;
      height = 2.35;
      lookAhead = 0.6;
      this.fov = damp(this.fov, 1.02, 5, dt);
    }

    const sinY = Math.sin(this.yaw), cosY = Math.cos(this.yaw);
    // heading convention shared with the cars and the people: forward is
    // (-sin yaw, 0, cos yaw), so a camera yaw of 0 looks along +z
    const fwd = [-sinY, 0, cosY];
    const right = [-cosY, 0, -sinY];

    const pitchLift = Math.sin(this.pitch) * back;
    const flat = Math.cos(this.pitch) * back;

    const focus = [
      subject.x + fwd[0] * lookAhead + right[0] * sideOffset,
      subject.y + (inCar ? 1.35 : 1.55),
      subject.z + fwd[2] * lookAhead + right[2] * sideOffset,
    ];

    let wantX = focus[0] - fwd[0] * flat;
    let wantY = focus[1] + height + pitchLift;
    let wantZ = focus[2] - fwd[2] * flat;

    // keep the lens out of walls and above the street
    const ground = world.groundAt(wantX, wantZ);
    wantY = Math.max(wantY, ground + 0.7);
    const probe = world.colliders.hits(wantX, wantZ, 0.65);
    if (probe) {
      const cx = clamp(wantX, probe.minx, probe.maxx);
      const cz = clamp(wantZ, probe.minz, probe.maxz);
      const dx = wantX - cx, dz = wantZ - cz;
      const d = Math.hypot(dx, dz) || 1;
      wantX = cx + (dx / d) * 0.9;
      wantZ = cz + (dz / d) * 0.9;
      wantY = Math.max(wantY, Math.min(probe.h, ground + 1.2) + 0.6);
    }

    if (this.snap) {
      this.pos = [wantX, wantY, wantZ];
      this.target = focus;
      this.snap = false;
    } else {
      const rate = inCar ? 9 : aiming ? 16 : 11;
      this.pos[0] = damp(this.pos[0], wantX, rate, dt);
      this.pos[1] = damp(this.pos[1], wantY, rate * 0.7, dt);
      this.pos[2] = damp(this.pos[2], wantZ, rate, dt);
      const tr = aiming ? 22 : 13;
      this.target[0] = damp(this.target[0], focus[0], tr, dt);
      this.target[1] = damp(this.target[1], focus[1], tr, dt);
      this.target[2] = damp(this.target[2], focus[2], tr, dt);
    }

    if (this.shake > 0.001) {
      const s = this.shake;
      this.pos[0] += (Math.random() - 0.5) * s;
      this.pos[1] += (Math.random() - 0.5) * s * 0.7;
      this.pos[2] += (Math.random() - 0.5) * s;
      this.shake = Math.max(0, this.shake - dt * 2.4);
    }
  }

  // Aim ray from the eye through the crosshair.
  aimRay() {
    const dir = V3.norm([
      this.target[0] - this.pos[0],
      this.target[1] - this.pos[1],
      this.target[2] - this.pos[2],
    ]);
    // in the aim-down-sights pose the shot goes where the crosshair sits
    const spread = 0.0;
    return { origin: this.pos, dir, spread };
  }

  // Where a shot should land, from a slightly lower origin.
  shotRay(originY) {
    const dir = V3.norm([
      this.target[0] - this.pos[0],
      this.target[1] - this.pos[1],
      this.target[2] - this.pos[2],
    ]);
    return { origin: [this.pos[0], originY, this.pos[2]], dir };
  }
}

export function makeFollowTarget(x, y, z) {
  return { x, y, z };
}
