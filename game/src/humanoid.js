// A low-poly humanoid built from primitives, shared by the player, pedestrians, cops and thugs.
// Each rig owns a handful of pivot groups (hips, torso, head, arms, legs) so a walk/run cycle, a
// pistol aim and a death fall are all just rotations. Cost per actor is ~14 boxes, so a crowd of
// thirty still draws in a few milliseconds.
import * as THREE from 'three';

const skinTones = [0xb87a52, 0x8a5433, 0x6b3c25, 0xd9a077, 0x5c3620, 0xc08a62];
const shirtColors = [0xe8e2d0, 0x3d6f8a, 0xa8483c, 0x2f4a52, 0xd9a13c, 0x6d5a8a, 0x4e7a4a, 0xdedede];
const pantsColors = [0x33383f, 0x6a6357, 0x2b3a4a, 0x8a8071, 0x4a4038, 0x1f2429];
const hairColors = [0x241a14, 0x3d2a1c, 0x120e0c, 0x5a3a22, 0x8a7a68];

const box = (w, h, d, color) => new THREE.Mesh(
  new THREE.BoxGeometry(w, h, d),
  new THREE.MeshLambertMaterial({ color }),
);

export class Humanoid {
  constructor(opts = {}) {
    const rnd = opts.random ?? (() => Math.random());
    const pick = (arr) => arr[Math.floor(rnd() * arr.length) % arr.length];
    const skin = opts.skin ?? pick(skinTones);
    const shirt = opts.shirt ?? pick(shirtColors);
    const pants = opts.pants ?? pick(pantsColors);
    const hair = opts.hair ?? pick(hairColors);
    const scale = opts.scale ?? 1;

    this.group = new THREE.Group();
    this.group.scale.setScalar(scale);
    this.rig = new THREE.Group();
    this.group.add(this.rig);

    // hips at 0.98 m: legs hang below, torso above
    this.hips = new THREE.Group();
    this.hips.position.y = 0.95;
    this.rig.add(this.hips);

    const pelvis = box(0.34, 0.22, 0.24, pants);
    pelvis.position.y = -0.06;
    this.hips.add(pelvis);

    this.torso = new THREE.Group();
    this.torso.position.y = 0.06;
    this.hips.add(this.torso);

    const chest = box(0.42, 0.52, 0.26, shirt);
    chest.position.y = 0.28;
    this.torso.add(chest);
    if (opts.vest) {
      const vest = box(0.46, 0.42, 0.3, opts.vest);
      vest.position.y = 0.3;
      this.torso.add(vest);
    }
    // shoulders
    const shoulders = box(0.52, 0.12, 0.26, shirt);
    shoulders.position.y = 0.5;
    this.torso.add(shoulders);

    this.neck = new THREE.Group();
    this.neck.position.y = 0.58;
    this.torso.add(this.neck);
    const head = box(0.22, 0.25, 0.22, skin);
    head.position.y = 0.13;
    this.neck.add(head);
    const hairMesh = box(0.24, 0.12, 0.24, hair);
    hairMesh.position.y = 0.235;
    this.neck.add(hairMesh);
    this.head = head;

    if (opts.longHair) {
      const back = box(0.24, 0.3, 0.1, hair);
      back.position.set(0, 0.06, -0.09);
      this.neck.add(back);
    }

    const arm = (side) => {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.29, 0.46, 0);
      const upper = box(0.12, 0.3, 0.13, opts.sleeves === false ? skin : shirt);
      upper.position.y = -0.14;
      pivot.add(upper);
      const lowerPivot = new THREE.Group();
      lowerPivot.position.y = -0.29;
      const lower = box(0.105, 0.28, 0.11, skin);
      lower.position.y = -0.13;
      lowerPivot.add(lower);
      const hand = box(0.1, 0.1, 0.1, skin);
      hand.position.y = -0.29;
      lowerPivot.add(hand);
      pivot.add(lowerPivot);
      return { pivot, lowerPivot };
    };
    this.armR = arm(1);
    this.armL = arm(-1);
    this.torso.add(this.armR.pivot, this.armL.pivot);

    const leg = (side) => {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.11, -0.12, 0);
      const thigh = box(0.15, 0.36, 0.17, pants);
      thigh.position.y = -0.19;
      pivot.add(thigh);
      const knee = new THREE.Group();
      knee.position.y = -0.38;
      const shin = box(0.135, 0.34, 0.15, pants);
      shin.position.y = -0.18;
      knee.add(shin);
      const foot = box(0.15, 0.09, 0.24, opts.shoes ?? 0x2b2b2b);
      foot.position.set(0, -0.37, 0.04);
      knee.add(foot);
      pivot.add(knee);
      return { pivot, knee };
    };
    this.legR = leg(1);
    this.legL = leg(-1);
    this.hips.add(this.legR.pivot, this.legL.pivot);

    // A pistol in the right hand, hidden unless aiming or firing.
    this.gun = new THREE.Group();
    const barrel = box(0.05, 0.05, 0.22, 0x2a2d33);
    barrel.position.set(0, 0, 0.09);
    this.gun.add(barrel);
    const grip = box(0.045, 0.11, 0.06, 0x1c1f24);
    grip.position.set(0, -0.07, 0.01);
    this.gun.add(grip);
    this.gun.position.set(0, -0.29, 0.05);
    this.gun.visible = false;
    this.armR.lowerPivot.add(this.gun);

    this.phase = rnd() * Math.PI * 2;
    this.speed = 0;
    this.aiming = false;
    this.dead = false;
    this.deadT = 0;

    this.group.traverse((o) => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; }
    });
  }

  setPosition(x, y, z) { this.group.position.set(x, y, z); }

  /** heading is radians around Y, 0 = facing -Z. */
  setHeading(h) { this.group.rotation.y = h; }

  /** speed in m/s drives the walk cycle amplitude and frequency. */
  update(dt, speed, { aiming = false, crouch = false } = {}) {
    this.speed = speed;
    if (this.dead) {
      this.deadT = Math.min(1, this.deadT + dt * 3.4);
      this.rig.rotation.x = -this.deadT * Math.PI * 0.47;
      this.rig.position.y = this.deadT * 0.06;
      return;
    }
    const stride = Math.min(1, Math.abs(speed) / 7.5);
    this.phase += dt * (3.1 + stride * 7.4) * (speed < -0.1 ? -1 : 1);
    const sw = Math.sin(this.phase) * (0.18 + stride * 0.72);
    const sw2 = Math.sin(this.phase + Math.PI) * (0.18 + stride * 0.72);
    this.legR.pivot.rotation.x = sw;
    this.legL.pivot.rotation.x = sw2;
    this.legR.knee.rotation.x = Math.max(0, -sw) * 0.9;
    this.legL.knee.rotation.x = Math.max(0, -sw2) * 0.9;
    const bob = Math.abs(Math.sin(this.phase)) * stride * 0.055;
    this.rig.position.y = bob + (crouch ? -0.24 : 0);
    this.hips.rotation.z = Math.sin(this.phase) * stride * 0.045;

    if (aiming) {
      this.armR.pivot.rotation.x = -1.5;
      this.armR.pivot.rotation.z = -0.14;
      this.armR.lowerPivot.rotation.x = 0.16;
      this.armL.pivot.rotation.x = -1.35;
      this.armL.pivot.rotation.z = 0.5;
      this.armL.lowerPivot.rotation.x = 0.34;
      this.torso.rotation.y = -0.12;
      this.gun.visible = true;
    } else {
      this.armR.pivot.rotation.x = sw2 * 0.85;
      this.armL.pivot.rotation.x = sw * 0.85;
      this.armR.pivot.rotation.z = 0.05;
      this.armL.pivot.rotation.z = -0.05;
      this.armR.lowerPivot.rotation.x = 0.2 + Math.max(0, sw2) * 0.5;
      this.armL.lowerPivot.rotation.x = 0.2 + Math.max(0, sw) * 0.5;
      this.torso.rotation.y = 0;
      this.gun.visible = false;
    }
    this.neck.rotation.y = this.aiming ? 0.12 : 0;
  }

  die() {
    this.dead = true;
    this.deadT = 0;
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose();
        o.material.dispose();
      }
    });
  }
}

export const HUMAN_PALETTE = { skinTones, shirtColors, pantsColors, hairColors };
