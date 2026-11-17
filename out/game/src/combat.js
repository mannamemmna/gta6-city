// Ballistics: hitscan for the player and for the police, tracers, impact sparks,
// blood and dust, and the damage bookkeeping that links a shot to a wanted level.
// Also drives the melee swing and the vehicle explosions' area damage.

import { V3, clamp } from './math3d.js';
import { rayBox } from './world.js';

export class Combat {
  constructor(world, game) {
    this.world = world;
    this.game = game;
    this.lastShot = 0;
    this.hitMarker = 0;
    this.kills = 0;
    this.recoil = 0;
    this.meleeTimer = 0;
  }

  update(dt, input, cam) {
    this.hitMarker = Math.max(0, this.hitMarker - dt * 3);
    this.meleeTimer = Math.max(0, this.meleeTimer - dt);
    const p = this.game.player;
    if (p.dead || p.vehicle) return;
    const w = p.currentWeapon();
    const wants = w.auto ? input.mouseDown : input.mouseClicked;
    if (wants && p.canFire()) {
      p.consumeShot();
      const pellets = w.pellets ?? 1;
      for (let i = 0; i < pellets; i++) this.playerShot(p, cam, w);
      this.recoil = Math.min(1, this.recoil + 0.5);
      this.game.audio.gunshot(p.gun);
      cam.shake = Math.min(0.35, cam.shake + (p.gun === 'shotgun' ? 0.26 : 0.10));
      this.game.police.crime('shot fired', 0.32);
      this.game.alarmLevel = Math.min(1, this.game.alarmLevel + 0.5);
      // the street reacts
      for (const ped of this.game.peds) {
        if (Math.hypot(ped.x - p.x, ped.z - p.z) < 30) ped.scare(p, 6);
      }
      this.muzzle = { x: p.x, z: p.z, y: p.y + 1.45, life: 0.05 };
    }
    if (input.mouseClicked && !w.auto && !p.canFire() && p.ammo[p.gun].mag === 0) {
      p.reload();
    }
    if (input.hit('KeyE')) this.melee(p);
  }

  playerShot(p, cam, w) {
    const ray = cam.shotRay(p.y + 1.45);
    const spread = w.spread * (this.game.player.aiming ? 0.45 : 1);
    const dir = V3.norm([
      ray.dir[0] + (Math.random() - 0.5) * spread,
      ray.dir[1] + (Math.random() - 0.5) * spread * 0.7,
      ray.dir[2] + (Math.random() - 0.5) * spread,
    ]);
    const origin = [p.x, p.y + 1.45, p.z];
    const result = this.trace(origin, dir, w.range, true);
    const end = result.point;
    this.world.addTracer([origin[0] + dir[0] * 0.7, origin[1] - 0.1, origin[2] + dir[2] * 0.7], end);

    if (result.kind === 'ped') {
      const dead = result.ref.hurt(w.dmg, dir, this.world);
      this.hitMarker = 1;
      this.world.addSpark(end[0], end[1], end[2], 5, [0.55, 0.05, 0.05]);
      if (dead) {
        this.kills++;
        this.game.police.crime('pedestrian down', 0.9);
        this.game.onPedKilled(result.ref);
      } else {
        this.game.police.crime('pedestrian down', 0.4);
      }
    } else if (result.kind === 'officer') {
      this.game.police.hitOfficer(result.ref, w.dmg, dir);
      this.hitMarker = 1;
      this.world.addSpark(end[0], end[1], end[2], 5, [0.55, 0.05, 0.05]);
    } else if (result.kind === 'vehicle') {
      result.ref.health -= w.dmg * 0.65;
      this.world.addSpark(end[0], end[1], end[2], 6, [1.0, 0.78, 0.34]);
      this.game.police.crime('property damage', 0.25);
      if (result.ref.health <= 0 && !result.ref.dead) {
        result.ref.explode(this.world);
        this.game.onVehicleDestroyed(result.ref);
      }
      if (result.ref.ai?.kind === 'traffic') result.ref.ai.kind = 'flee';
    } else if (result.kind === 'world') {
      this.world.addSpark(end[0], end[1], end[2], 4, [0.85, 0.84, 0.80]);
    }
  }

  // One hitscan pass: pedestrians, officers, vehicles, then city boxes.
  trace(origin, dir, range, fromPlayer) {
    let best = { t: range, kind: 'air', point: V3.add(origin, V3.scale(dir, range)), ref: null };
    const consider = (x, y, z, radius, height, kind, ref) => {
      // cylinder test
      const ox = x - origin[0], oz = z - origin[2];
      const tProj = ox * dir[0] + oz * dir[2];
      const perp2 = ox * ox + oz * oz - tProj * tProj;
      if (perp2 > radius * radius) return;
      const half = Math.sqrt(Math.max(0, radius * radius - perp2));
      let t = tProj - half;
      if (t < 0.2) t = tProj + half;
      if (t < 0.2 || t > best.t) return;
      const py = origin[1] + dir[1] * t;
      if (py < y - 0.1 || py > y + height) return;
      best = { t, kind, point: V3.add(origin, V3.scale(dir, t)), ref };
    };

    if (fromPlayer) {
      for (const ped of this.game.peds) {
        if (ped.dead) continue;
        consider(ped.x, ped.y, ped.z, 0.46, 1.9, 'ped', ped);
      }
    }
    for (const o of this.game.police.officers) {
      if (o.down) continue;
      consider(o.x, o.y, o.z, 0.46, 1.9, 'officer', o);
    }
    for (const v of this.game.vehicles) {
      if (v.dead) continue;
      const ex = Math.abs(v.x - origin[0]), ez = Math.abs(v.z - origin[2]);
      if (ex > 12 && ez > 12) continue;
      consider(v.x, v.y, v.z, v.spec.len * 0.42, v.spec.hgt + 0.4, 'vehicle', v);
    }

    // city boxes near the ray
    const step = 6;
    const maxT = Math.min(best.t, range);
    for (let t = 0; t < maxT; t += step) {
      const px = origin[0] + dir[0] * t;
      const pz = origin[2] + dir[2] * t;
      const boxes = this.world.colliders.query(px, pz, step);
      for (const b of boxes) {
        const hit = rayBox(origin, dir, b, best.t);
        if (hit !== null && hit < best.t && hit > 0.2) {
          best = { t: hit, kind: 'world', point: V3.add(origin, V3.scale(dir, hit)), ref: b };
        }
      }
      if (best.kind === 'world' && best.t < t) break;
    }
    return best;
  }

  melee(p) {
    if (this.meleeTimer > 0 || p.vehicle) return;
    this.meleeTimer = 0.42;
    this.game.audio.punch();
    const fwd = [-Math.sin(p.yaw), -Math.cos(p.yaw)];
    for (const ped of this.game.peds) {
      const dx = ped.x - p.x, dz = ped.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 2.0 && dx * fwd[0] + dz * fwd[1] > 0.4) {
        ped.hurt(55, fwd, this.world);
        this.game.audio.impact();
        this.game.police.crime('assault', 0.5);
        return;
      }
    }
    for (const o of this.game.police.officers) {
      if (o.down) continue;
      const dx = o.x - p.x, dz = o.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 2.0 && dx * fwd[0] + dz * fwd[1] > 0.4) {
        this.game.police.hitOfficer(o, 30, fwd);
        this.game.audio.impact();
        return;
      }
    }
  }

  // Police fire back at the player.
  officerShot(officer, target, level) {
    const origin = [officer.x, officer.y + 1.42, officer.z];
    const spread = 0.06 + Math.max(0, 3 - level) * 0.03;
    const dir = V3.norm([
      (target.x - origin[0]) / Math.max(1, Math.hypot(target.x - officer.x, target.z - officer.z)) +
        (Math.random() - 0.5) * spread,
      (Math.random() - 0.5) * spread * 0.6,
      (target.z - origin[2]) / Math.max(1, Math.hypot(target.x - officer.x, target.z - officer.z)) +
        (Math.random() - 0.5) * spread,
    ]);
    const dist = Math.hypot(target.x - officer.x, target.z - officer.z);
    const hitRoll = Math.random() < clamp(1 - dist / 90, 0.12, 0.72);
    const end = hitRoll
      ? [target.x, (this.game.player.vehicle ? this.game.player.vehicle.y + 1.0 : this.game.player.y + 1.2), target.z]
      : [origin[0] + dir[0] * 60, origin[1] + dir[1] * 60, origin[2] + dir[2] * 60];
    this.world.addTracer(origin, end);
    this.game.audio.distantShot(dist);
    if (hitRoll) {
      const dmg = 6 + Math.random() * 5 + level * 1.6;
      if (this.game.player.vehicle) {
        this.game.player.vehicle.health -= dmg * 0.9;
        this.world.addSpark(end[0], end[1], end[2], 3, [1, 0.85, 0.4]);
        if (this.game.player.vehicle.health <= 0) this.game.player.vehicle.explode(this.world);
      } else {
        this.game.player.damage(dmg, officer);
        this.world.addSpark(end[0], end[1], end[2], 4, [0.6, 0.06, 0.06]);
        this.game.cam.shake = Math.min(0.4, this.game.cam.shake + 0.12);
        this.game.audio.playerHit();
      }
    }
  }

  // Area damage when a car goes up.
  explosion(x, z, radius = 9) {
    const p = this.game.player;
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < radius) p.damage(40 * (1 - d / radius), { x, z });
    for (const ped of this.game.peds) {
      const dd = Math.hypot(ped.x - x, ped.z - z);
      if (dd < radius) ped.hurt(100 * (1 - dd / radius), { x: x - ped.x, z: z - ped.z }, this.world);
    }
    for (const o of this.game.police.officers) {
      const dd = Math.hypot(o.x - x, o.z - z);
      if (dd < radius) this.game.police.hitOfficer(o, 100 * (1 - dd / radius), null);
    }
    for (const v of this.game.vehicles) {
      if (v.dead) continue;
      const dd = Math.hypot(v.x - x, v.z - z);
      if (dd < radius * 0.9 && dd > 0.1) {
        v.health -= 70 * (1 - dd / radius);
        if (v.health <= 0) v.explode(this.world);
      }
    }
  }
}
