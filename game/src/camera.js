// Third-person follow camera: mouse-orbit yaw/pitch, spring-arm distance that shortens when a
// building would sit between the player and the lens, a speed-dependent FOV kick while driving and
// a light shake on gunfire or impacts.
import * as THREE from 'three';

export class ThirdPersonCamera {
  constructor(camera, city) {
    this.camera = camera;
    this.city = city;
    this.yaw = Math.PI;
    this.pitch = 0.2;
    this.distance = 5.2;
    this.targetDistance = 5.2;
    this.fov = 62;
    this.shake = 0;
    this.position = new THREE.Vector3();
    this.lookAt = new THREE.Vector3();
    this.initialised = false;
  }

  addShake(amount) { this.shake = Math.min(0.55, this.shake + amount); }

  orbit(dx, dy) {
    this.yaw -= dx;
    this.pitch = Math.max(-0.42, Math.min(0.86, this.pitch + dy));
  }

  /** Places the camera behind an anchor point, keeping the lens out of geometry. */
  update(dt, anchor, opts = {}) {
    const driving = opts.driving === false ? false : true;
    const desired = (opts.distance ?? 5.4) + (opts.speedBoost ?? 0);
    this.targetDistance = desired;
    this.distance += (this.targetDistance - this.distance) * Math.min(1, dt * 3.2);

    const fx = Math.sin(this.yaw) * Math.cos(this.pitch);
    const fz = Math.cos(this.yaw) * Math.cos(this.pitch);
    const fy = Math.sin(this.pitch) + (opts.heightBias ?? 0);

    const targetY = anchor.y + (opts.targetHeight ?? 1.55);
    const back = this.distance;
    let px = anchor.x + fx * back;
    let py = targetY + fy * back;
    let pz = anchor.z + fz * back;

    // spring arm: step back toward the anchor while inside a building box
    const solid = (x, y, z) => {
      if (y < 0.2) return false;
      for (const c of this.city.colliders) {
        if (c.isWater) continue;
        if (x > c.minX - 0.3 && x < c.maxX + 0.3 && z > c.minZ - 0.3 && z < c.maxZ + 0.3) return true;
      }
      return false;
    };
    let t = 1;
    for (let i = 1; i <= 6; i += 1) {
      const k = i / 6;
      if (solid(anchor.x + (px - anchor.x) * k, targetY + (py - targetY) * k, anchor.z + (pz - anchor.z) * k)) {
        t = Math.max(0.22, k - 0.16);
        break;
      }
    }
    px = anchor.x + (px - anchor.x) * t;
    py = targetY + (py - targetY) * t;
    pz = anchor.z + (pz - anchor.z) * t;

    if (py < 0.7) py = 0.7;

    if (this.shake > 0.001) {
      const s = this.shake;
      px += (Math.random() - 0.5) * s;
      py += (Math.random() - 0.5) * s * 0.7;
      pz += (Math.random() - 0.5) * s;
      this.shake *= Math.max(0, 1 - dt * 6);
    }

    this.camera.position.set(px, py, pz);
    this.lookAt.set(anchor.x, targetY + 0.15, anchor.z);
    this.camera.lookAt(this.lookAt);

    const targetFov = (opts.fov ?? 62) + Math.min(14, (opts.speed ?? 0) * 0.28);
    this.fov += (targetFov - this.fov) * Math.min(1, dt * 2.2);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
    this.initialised = true;
  }

  /** Direction the player faces on foot: the camera's horizontal forward. */
  forward() {
    return { x: Math.sin(this.yaw), z: Math.cos(this.yaw) };
  }
}

/** A fixed cinematic camera used by the title screen backdrop and the vista shot. */
export class OrbitCamera {
  constructor(camera) {
    this.camera = camera;
    this.angle = 0;
    this.speed = 0.035;
  }
  update(dt, centre, radius, height, lookY) {
    this.angle += dt * this.speed;
    this.camera.position.set(
      centre.x + Math.sin(this.angle) * radius,
      height,
      centre.z + Math.cos(this.angle) * radius,
    );
    this.camera.lookAt(centre.x, lookY, centre.z);
  }
}

export { THREE };
