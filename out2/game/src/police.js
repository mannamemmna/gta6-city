// The Cobalt Bay Police Department: a wanted meter that climbs with every crime,
// cruisers that spawn out of sight and drive at you, foot officers who get out and
// shoot, and a search clock that bleeds the stars away when you break line of sight.

import { COP, VEHICLES } from './config.js';
import { angleDelta, clamp, damp } from './math3d.js';
import { drawPerson, vehicleSpec } from './models.js';
import { Vehicle } from './vehicles.js';
import { driveTo } from './traffic.js';

const MAT = { LIT: 0, GLOW: 1 };

export class Police {
  constructor(world, game) {
    this.world = world;
    this.game = game;
    this.units = [];
    this.officers = [];
    this.level = 0;
    this.meter = 0;         // 0..1 progress to the next star
    this.heat = 0;          // decays when unseen
    this.searchTimer = 0;
    this.chaseSpeed = 30;
    this.spawnTimer = 0;
    this.lastCrime = '';
    this.spotted = false;
    this.bustTimer = 0;
  }

  get spec() { return COP.car; }

  crime(kind, weight = 1) {
    const wasLevel = this.level;
    this.meter += weight;
    this.lastCrime = kind;
    while (this.meter >= 1) {
      this.meter -= 1;
      this.level = Math.min(5, this.level + 1);
    }
    this.heat = 1;
    this.searchTimer = 0;
    if (this.level > wasLevel) {
      this.game.hud.toast(`${this.level} star${this.level > 1 ? 's' : ''} · ${crimeLine(kind)}`, 'warn');
      this.game.audio.sirenBlip();
    }
  }

  clear() {
    this.level = 0;
    this.meter = 0;
    this.heat = 0;
    this.searchTimer = 0;
    for (const u of this.units) u.car.ai = null;
    this.units.length = 0;
    this.officers.length = 0;
  }

  update(dt, game) {
    const player = game.player;
    const ppos = player.vehicle ? { x: player.vehicle.x, z: player.vehicle.z } : { x: player.x, z: player.z };

    // decay the wanted level when nobody can see you
    if (this.level > 0) {
      this.spotted = this.canSee(ppos);
      if (!this.spotted) {
        this.searchTimer += dt;
        if (this.searchTimer > 6) {
          this.meter -= dt * 0.14;
          if (this.meter < 0) {
            this.meter = 0;
            this.level -= 1;
            this.game.hud.toast('You lost them', 'good');
            if (this.level > 0) this.meter = 0.6;
          }
        }
      } else {
        this.searchTimer = 0;
      }
      if (this.searchTimer > 26) { this.clear(); this.game.hud.toast('Wanted level cleared', 'good'); }
    }

    // spawn and retire units
    const desired = this.level > 0 ? COP.levels[Math.min(4, this.level - 1)].units : 0;
    this.spawnTimer -= dt;
    if (this.units.length < desired && this.spawnTimer <= 0) {
      this.spawnUnit(ppos);
      this.spawnTimer = 1.4;
    }
    while (this.units.length > desired) {
      const u = this.units.pop();
      u.car.ai = null;
    }

    const lvl = COP.levels[Math.min(4, Math.max(0, this.level - 1))];
    this.chaseSpeed = 26 + lvl.speed * 8;

    for (const u of this.units) {
      const d = Math.hypot(u.car.x - ppos.x, u.car.z - ppos.z);
      if (!u.car.ai) {
        u.car.ai = { kind: 'chase', shirt: [0.10, 0.14, 0.24] };
      }
      u.car.siren += dt * (8 + this.level);
      // bail out and shoot if the player stops
      if (d < 22 && this.level >= 2 && !u.dismounted && (!player.vehicle || player.vehicle.speed < 2)) {
        this.dismount(u, ppos);
      }
      if (u.dismounted) {
        if (d < 60 && this.level >= 2) u.officer.shooting = this.rngShoot(dt, lvl.shoot);
      }
    }

    // foot officers: chase and fire
    for (const o of this.officers) {
      if (o.down) { o.timer += dt; continue; }
      const dx = ppos.x - o.x, dz = ppos.z - o.z;
      const d = Math.hypot(dx, dz) || 1;
      o.yaw += angleDelta(o.yaw, Math.atan2(-dx, dz)) * Math.min(1, dt * 8);
      const stopAt = 12;
      let step = 0;
      if (d > stopAt) step = 4.6 * dt;
      else if (d < 6) step = -2.4 * dt;
      const nx = o.x + (dx / d) * step, nz = o.z + (dz / d) * step;
      const [rx, rz] = this.world.colliders.resolve(nx, nz, 0.35);
      o.x = rx; o.z = rz;
      o.y = this.world.groundAt(o.x, o.z);
      o.moving = damp(o.moving, Math.abs(step) > 0.001 ? 1 : 0, 6, dt);
      o.phase += dt * (1 + o.moving * 2);
      o.aim = d < 40;
      o.fireTimer -= dt;
      if (d < 42 && o.fireTimer <= 0 && this.level >= 2) {
        o.fireTimer = 0.7 + Math.random() * 0.9;
        game.combat.officerShot(o, ppos, this.level);
      }
    }

    // busted: three officers close and you're cuffed
    let near = 0;
    for (const o of this.officers) if (!o.down && Math.hypot(o.x - ppos.x, o.z - ppos.z) < 5) near++;
    if (near >= 2 && this.level >= 1 && (player.vehicle ? player.vehicle.speed < 1.5 : player.speed < 1.5)) {
      this.bustTimer += dt;
      if (this.bustTimer > 1.6) game.onBusted();
    } else this.bustTimer = 0;
  }

  rngShoot(dt, chance) {
    if (Math.random() < chance * dt * 0.5) {
      this.officerFireTimer = (this.officerFireTimer ?? 0) - dt;
      if (this.officerFireTimer <= 0) { this.officerFireTimer = 0.5; return true; }
    }
    return false;
  }

  canSee(ppos) {
    for (const u of this.units) {
      const d = Math.hypot(u.car.x - ppos.x, u.car.z - ppos.z);
      if (d < 95) return true;
    }
    for (const o of this.officers) {
      if (Math.hypot(o.x - ppos.x, o.z - ppos.z) < 55) return true;
    }
    return false;
  }

  spawnUnit(ppos) {
    // find a road node out of the player's sight, 80-190 m away
    const nodes = this.world.city.nodes.flat();
    let best = null, bestScore = -1;
    const player = this.game.player;
    const pyaw = player.vehicle ? player.vehicle.yaw : player.yaw;
    for (const n of nodes) {
      const d = Math.hypot(n.x - ppos.x, n.z - ppos.z);
      if (d < 70 || d > 210) continue;
      const dirToNode = Math.atan2(-(n.x - ppos.x), (n.z - ppos.z));
      const behind = Math.abs(angleDelta(pyaw, dirToNode));
      const score = d * 0.5 + behind * 40;
      if (score > bestScore) { bestScore = score; best = n; }
    }
    if (!best) return;
    const link = best.links[Math.floor(Math.random() * best.links.length)];
    const yaw = Math.atan2(-(link.x - best.x), (link.z - best.z));
    const car = new Vehicle(this.world, COP.car, best.x, best.z, yaw);
    car.carColor = [0.93, 0.94, 0.95];
    car.ai = { kind: 'chase', shirt: [0.10, 0.14, 0.24] };
    car.siren = Math.random() * 6;
    car.lane = { from: best, to: link, dir: 1 };
    this.game.vehicles.push(car);
    this.units.push({ car, dismounted: false, officer: null });
  }

  dismount(u, ppos) {
    u.dismounted = true;
    u.car.ai = null;
    u.car.driver = null;
    const o = {
      x: u.car.x - Math.cos(u.car.yaw) * 1.8,
      z: u.car.z + Math.sin(u.car.yaw) * 1.6,
      y: 0, yaw: u.car.yaw, phase: 0, moving: 0, aim: true,
      fireTimer: 1.2, down: false, timer: 0, health: 70,
      shirt: [0.14, 0.18, 0.30], pants: [0.10, 0.12, 0.18],
      skin: [0.84, 0.68, 0.52], hair: [0.10, 0.09, 0.08], hat: [0.10, 0.13, 0.22],
    };
    o.y = this.world.groundAt(o.x, o.z);
    this.officers.push(o);
    u.officer = o;
  }

  // bullets can knock an officer down
  hitOfficer(o, dmg, dir) {
    o.health -= dmg;
    if (o.health <= 0 && !o.down) {
      o.down = true;
      this.world.addDecal(o.x, o.z, 1.0, [0.36, 0.05, 0.06], 26);
      this.crime('officer down', 1.6);
    }
  }

  draw(buf) {
    for (const o of this.officers) {
      drawPerson(buf, {
        x: o.x, y: o.y, z: o.z, yaw: o.yaw,
        shirt: o.shirt, pants: o.pants, skin: o.skin, hair: o.hair, hat: o.hat,
        phase: o.phase, moving: o.moving, aim: o.aim && !o.down,
        gun: true, armed: true, down: o.down,
      });
    }
    // one soft flare sliding from side to side with the light bar
    for (const u of this.units) {
      const beat = Math.sin(u.car.siren);
      const t = beat > 0;
      const c = t ? [1.0, 0.34, 0.26] : [0.32, 0.54, 1.0];
      const k = 0.35 + 0.55 * Math.abs(beat);
      const offx = (t ? -1 : 1) * 0.7;
      buf.push(u.car.x + offx, u.car.y + 0.07, u.car.z, 3.6, 0.02, 4.6, u.car.yaw,
        [c[0] * k * 0.5, c[1] * k * 0.5, c[2] * k * 0.5], MAT.GLOW);
    }
  }
}

export function crimeLine(kind) {
  switch (kind) {
    case 'shot fired': return 'Shots fired';
    case 'pedestrian down': return 'Civilian down';
    case 'officer down': return 'Officer down';
    case 'grand theft auto': return 'Grand theft auto';
    case 'property damage': return 'Property damage';
    case 'speeding': return 'Reckless driving';
    default: return 'Disturbing the peace';
  }
}
