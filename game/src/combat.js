// Gunfire and its effects: a hitscan pistol with recoil, tracers, muzzle flash, wall sparks, blood
// puffs and car explosions. Effects are pooled sprites and short-lived meshes so firing a whole
// magazine never allocates a new material.
import * as THREE from 'three';
import { PLAYER } from './config.js';
import { raySphere } from './pedestrians.js';

const MAX_TRACERS = 26;

function spriteTexture(kind) {
  const canvas = document.createElement('canvas');
  canvas.width = 64; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (kind === 'flash') {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,235,1)');
    g.addColorStop(0.3, 'rgba(255,214,120,0.9)');
    g.addColorStop(1, 'rgba(255,150,40,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  } else if (kind === 'spark') {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,246,210,1)');
    g.addColorStop(0.4, 'rgba(255,190,90,0.75)');
    g.addColorStop(1, 'rgba(255,120,30,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  } else if (kind === 'smoke') {
    const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
    g.addColorStop(0, 'rgba(120,110,105,0.85)');
    g.addColorStop(1, 'rgba(80,74,70,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  } else {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
    g.addColorStop(0, 'rgba(255,80,50,1)');
    g.addColorStop(1, 'rgba(190,20,10,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class CombatSystem {
  constructor(city, scene, opts = {}) {
    this.city = city;
    this.scene = scene;
    this.tracers = [];
    this.flashes = [];
    this.puffs = [];
    this.explosions = [];
    this.decals = [];
    this.onKill = null;
    this.onDamagePlayer = null;
    this.stats = { shots: 0, hits: 0, kills: 0 };
    this.tex = {
      flash: spriteTexture('flash'),
      spark: spriteTexture('spark'),
      smoke: spriteTexture('smoke'),
      blood: spriteTexture('blood'),
    };
    // tracer pool: thin additive quads, reused
    this.tracerGroup = new THREE.Group();
    scene.add(this.tracerGroup);
    for (let i = 0; i < MAX_TRACERS; i += 1) {
      const geo = new THREE.PlaneGeometry(1, 1);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xfff0c0, transparent: true, opacity: 0, depthWrite: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      this.tracerGroup.add(mesh);
      this.tracers.push({ mesh, life: 0 });
    }
    this.tracerIndex = 0;
    // one reusable directional light for muzzle flashes near the player
    this.flashLight = new THREE.PointLight(0xffd08a, 0, 18, 2);
    scene.add(this.flashLight);
    this.flashLightLife = 0;
    this.sparkPool = [];
  }

  /** A ray against the world: returns distance to the first building face hit, or maxDist. */
  rayWorld(origin, dir, maxDist) {
    let best = maxDist;
    const step = 0.6;
    for (let t = 0.5; t < maxDist; t += step) {
      const x = origin.x + dir.x * t;
      const y = origin.y + dir.y * t;
      const z = origin.z + dir.z * t;
      if (y < 0) return Math.min(best, t);
      for (const c of this.city.colliders) {
        if (c.isWater) continue;
        if (x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ && y < (c.top ?? 60)) {
          return Math.min(best, t);
        }
      }
    }
    return best;
  }

  /** Fires one pistol round from `origin` along `dir`. */
  fire(origin, dir, { damage = 34, range = PLAYER.weaponRange, fromPlayer = true } = {}) {
    this.stats.shots += 1;
    const worldDist = this.rayWorld(origin, dir, range);
    let end = {
      x: origin.x + dir.x * worldDist, y: origin.y + dir.y * worldDist, z: origin.z + dir.z * worldDist,
    };
    let hitSomething = null;
    const pedHit = this.pedSystem?.hitTest(origin, dir, worldDist);
    const officerHit = this.policeSystem?.hitOfficer(origin, dir, worldDist);
    const carHit = this.carHitTest(origin, dir, worldDist);
    let bestT = worldDist;
    if (pedHit && pedHit.t < bestT) { bestT = pedHit.t; hitSomething = { kind: 'ped', target: pedHit.ped }; }
    if (officerHit && officerHit.t < bestT) { bestT = officerHit.t; hitSomething = { kind: 'officer', target: officerHit.officer }; }
    if (carHit && carHit.t < bestT) { bestT = carHit.t; hitSomething = { kind: 'car', target: carHit.car }; }
    if (hitSomething) {
      end = { x: origin.x + dir.x * bestT, y: origin.y + dir.y * bestT, z: origin.z + dir.z * bestT };
      this.stats.hits += 1;
      if (hitSomething.kind === 'ped') {
        this.puff(end, 'blood');
        this.pedSystem.kill(hitSomething.target);
        this.stats.kills += 1;
        if (fromPlayer) this.onKill?.({ kind: 'ped', target: hitSomething.target });
      } else if (hitSomething.kind === 'officer') {
        this.puff(end, 'blood');
        hitSomething.target.hp -= damage;
        if (hitSomething.target.hp <= 0) {
          this.policeSystem.killOfficer(hitSomething.target);
          this.stats.kills += 1;
          if (fromPlayer) this.onKill?.({ kind: 'officer', target: hitSomething.target });
        }
      } else {
        this.sparks(end.x, end.y, end.z);
        const car = hitSomething.target;
        car.health -= damage * 0.55;
        if (car.health <= 0) this.explode(car.x, car.z, 3.6);
      }
    } else {
      if (worldDist < range - 0.5) this.sparks(end.x, end.y, end.z);
    }
    this.trace(origin, end);
    return { end, hit: hitSomething };
  }

  carHitTest(origin, dir, maxDist) {
    let best = null;
    let bestT = maxDist;
    for (const car of (this.trafficSystem?.cars ?? [])) {
      if (car.occupant) continue;
      const t = raySphere(origin, dir, { x: car.x, y: 0.9, z: car.z }, 1.5);
      if (t !== null && t < bestT) { bestT = t; best = car; }
    }
    return best ? { car: best, t: bestT } : null;
  }

  trace(from, to) {
    const slot = this.tracers[this.tracerIndex % MAX_TRACERS];
    this.tracerIndex += 1;
    const m = slot.mesh;
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    m.position.set((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
    m.scale.set(0.05, len, 1);
    m.visible = true;
    m.material.opacity = 0.9;
    // orient the plane along the ray, facing the camera-ish
    m.lookAt(to.x, to.y, to.z);
    m.rotateX(Math.PI / 2);
    slot.life = 0.07;
    this.flash(from, 0.9);
  }

  flash(pos, scale = 1) {
    const mat = new THREE.SpriteMaterial({
      map: this.tex.flash, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.position.set(pos.x, pos.y, pos.z);
    sprite.scale.setScalar(0.7 * scale);
    this.scene.add(sprite);
    this.flashes.push({ sprite, life: 0.07, ttl: 0.07 });
    this.flashLight.position.set(pos.x, pos.y + 0.2, pos.z);
    this.flashLight.intensity = 22;
    this.flashLightLife = 0.06;
  }

  sparks(x, y, z) {
    for (let i = 0; i < 4; i += 1) {
      const mat = new THREE.SpriteMaterial({
        map: this.tex.spark, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
      });
      const s = new THREE.Sprite(mat);
      s.position.set(x, y, z);
      s.scale.setScalar(0.3 + Math.random() * 0.4);
      this.scene.add(s);
      this.puffs.push({
        sprite: s, life: 0.34, ttl: 0.34,
        vx: (Math.random() - 0.5) * 3, vy: Math.random() * 2.4, vz: (Math.random() - 0.5) * 3,
      });
    }
  }

  puff(pos, kind) {
    const mat = new THREE.SpriteMaterial({
      map: kind === 'blood' ? this.tex.blood : this.tex.smoke,
      transparent: true, depthWrite: false,
    });
    const s = new THREE.Sprite(mat);
    s.position.set(pos.x, pos.y, pos.z);
    s.scale.setScalar(0.9);
    this.scene.add(s);
    this.puffs.push({ sprite: s, life: 0.5, ttl: 0.5, vx: (Math.random() - 0.5), vy: 0.6, vz: (Math.random() - 0.5) });
  }

  explode(x, z, radius) {
    const pos = { x, y: 1.1, z };
    for (let i = 0; i < 12; i += 1) {
      const mat = new THREE.SpriteMaterial({
        map: i < 6 ? this.tex.flash : this.tex.smoke,
        blending: i < 6 ? THREE.AdditiveBlending : THREE.NormalBlending,
        depthWrite: false, transparent: true,
      });
      const s = new THREE.Sprite(mat);
      s.position.set(x + (Math.random() - 0.5) * 1.6, 0.8 + Math.random() * 1.4, z + (Math.random() - 0.5) * 1.6);
      s.scale.setScalar(1.6 + Math.random() * 2.2);
      this.scene.add(s);
      this.puffs.push({
        sprite: s, life: 1.2 + Math.random() * 0.5, ttl: 1.7,
        vx: (Math.random() - 0.5) * 2.4, vy: 1.2 + Math.random() * 2.4, vz: (Math.random() - 0.5) * 2.4,
      });
    }
    this.flashLight.position.set(x, 2.4, z);
    this.flashLight.intensity = 90;
    this.flashLightLife = 0.45;
    this.explosions.push({ x, z, t: 0, radius });
    if (this.onExplosion) this.onExplosion(x, z, radius);
  }

  update(dt) {
    for (const t of this.tracers) {
      if (t.life > 0) {
        t.life -= dt;
        t.mesh.material.opacity = Math.max(0, t.life / 0.07) * 0.9;
        if (t.life <= 0) t.mesh.visible = false;
      }
    }
    for (let i = this.flashes.length - 1; i >= 0; i -= 1) {
      const f = this.flashes[i];
      f.life -= dt;
      f.sprite.material.opacity = Math.max(0, f.life / f.ttl);
      f.sprite.scale.multiplyScalar(1 + dt * 12);
      if (f.life <= 0) { this.scene.remove(f.sprite); f.sprite.material.dispose(); this.flashes.splice(i, 1); }
    }
    for (let i = this.puffs.length - 1; i >= 0; i -= 1) {
      const p = this.puffs[i];
      p.life -= dt;
      p.sprite.position.x += p.vx * dt;
      p.sprite.position.y += p.vy * dt;
      p.sprite.position.z += p.vz * dt;
      p.vy -= dt * 1.6;
      p.sprite.material.opacity = Math.max(0, p.life / p.ttl);
      if (p.life <= 0) { this.scene.remove(p.sprite); p.sprite.material.dispose(); this.puffs.splice(i, 1); }
    }
    this.flashLightLife -= dt;
    if (this.flashLightLife <= 0) this.flashLight.intensity *= Math.max(0, 1 - dt * 14);
    for (const e of this.explosions) e.t += dt;
  }

  bind(pedSystem, policeSystem, trafficSystem) {
    this.pedSystem = pedSystem;
    this.policeSystem = policeSystem;
    this.trafficSystem = trafficSystem;
  }
}
