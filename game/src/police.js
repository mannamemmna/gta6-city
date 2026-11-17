// The wanted level and the police that answer it. Stars 1-5 gate how many cruisers spawn, how
// aggressive they are and whether they shoot. Cruisers drive to the player, ram at low stars,
// disgorge officers at high stars, and the whole response decays when the player breaks line of
// sight. Road spikes and a helicopter pad out the top of the scale.
import * as THREE from 'three';
import { Car } from './vehicles.js';
import { Humanoid } from './humanoid.js';
import { createRandom } from './rng.js';
import { WANTED } from './config.js';

const CRUISER_COLORS = [0xf2efe6, 0xe8e4d8];

export class PoliceSystem {
  constructor(city, scene, seed = 404) {
    this.city = city;
    this.scene = scene;
    this.rng = createRandom(seed);
    this.wanted = 0;
    this.heat = 0;              // seconds at the current level, drives escalation
    this.decay = 0;
    this.cruisers = [];
    this.officers = [];
    this.seen = false;
    this.siren = 0;
    this.lastSpawn = 0;
    this.bustTimer = 0;
    this.copShots = [];
    this.onArrest = null;
    this.maxCruisers = 0;
  }

  setWanted(stars, { silent = false } = {}) {
    const next = Math.max(0, Math.min(5, Math.round(stars)));
    if (next === this.wanted) return;
    this.wanted = next;
    this.decay = 0;
    this.heat = 0;
    if (next === 0) this.standDown();
  }

  addWanted(stars, reason = '') {
    const before = this.wanted;
    this.setWanted(Math.max(this.wanted, stars));
    if (this.wanted > before) this.justEscalated = { from: before, to: this.wanted, reason, t: 2.4 };
  }

  standDown() {
    for (const c of this.cruisers) { this.scene.remove(c.car.group); c.car.dispose(); }
    this.cruisers.length = 0;
    for (const o of this.officers) { this.scene.remove(o.rig.group); o.rig.dispose(); }
    this.officers.length = 0;
  }

  spawnCruiser(offscreen = true) {
    const player = this.playerRef;
    if (!player) return null;
    let x, z;
    if (offscreen) {
      // spawn on a road a little way from the player, preferably out of view
      const angle = this.rng.range(0, Math.PI * 2);
      const dist = this.rng.range(70, 110);
      const road = this.city.nearestRoad(player.x + Math.sin(angle) * dist, player.z + Math.cos(angle) * dist);
      x = road.x;
      z = road.z;
    } else {
      x = player.x + 6; z = player.z + 6;
    }
    const car = new Car('patrulla', {
      x, z, heading: this.rng.range(0, 6.28), color: this.rng.pick(CRUISER_COLORS), ai: 'police',
    });
    car.group.userData.car = car;
    this.scene.add(car.group);
    const cruiser = { car, state: 'pursue', fireCooldown: 0, officersAboard: 2, stuck: 0, sirenPhase: this.rng.range(0, 6) };
    car.cruiser = cruiser;
    this.cruisers.push(cruiser);
    return cruiser;
  }

  /** The number of cruisers the current star rating justifies. */
  targetCruisers() {
    const table = [0, 1, 2, 3, 4, 6];
    return table[this.wanted] ?? 0;
  }

  update(dt, player, combat, audio) {
    this.playerRef = player;
    this.justEscalated = this.justEscalated && (this.justEscalated.t -= dt) > 0 ? this.justEscalated : null;
    if (this.wanted <= 0) { this.seen = false; return; }
    this.heat += dt;
    this.siren += dt;

    const px = player.car ? player.car.x : player.x;
    const pz = player.car ? player.car.z : player.z;
    const target = this.targetCruisers();

    // spawn cruisers steadily until the star level is satisfied
    this.lastSpawn -= dt;
    if (this.cruisers.length < target && this.lastSpawn <= 0) {
      this.spawnCruiser(true);
      this.lastSpawn = 1.4 + this.rng.range(0, 1.2);
    }

    // "seen": a cruiser close with a clear enough angle keeps the heat on
    let nearest = Infinity;
    for (const c of this.cruisers) {
      const d = Math.hypot(c.car.x - px, c.car.z - pz);
      nearest = Math.min(nearest, d);
    }
    this.seen = nearest < 105;
    if (this.seen) this.decay = 0;
    else {
      this.decay += dt;
      if (this.decay > WANTED.decaySeconds) {
        this.decay = 0;
        this.setWanted(this.wanted - 1);
        if (audio && this.wanted === 0) audio.play('evade');
      }
    }

    for (const cruiser of this.cruisers) this.updateCruiser(cruiser, dt, player, combat, px, pz);
    // remove cruisers that are far away or wrecked
    for (let i = this.cruisers.length - 1; i >= 0; i -= 1) {
      const c = this.cruisers[i];
      if (c.car.health <= 0) {
        combat.explode(c.car.x, c.car.z, 2.4);
        this.scene.remove(c.car.group);
        c.car.dispose();
        this.cruisers.splice(i, 1);
      } else if (Math.hypot(c.car.x - px, c.car.z - pz) > 260) {
        this.scene.remove(c.car.group);
        c.car.dispose();
        this.cruisers.splice(i, 1);
      }
    }
    for (const o of this.officers) this.updateOfficer(o, dt, player, combat, px, pz);

    // arrest: an officer on foot right beside a stationary player
    const onFoot = !player.car;
    let closeOfficer = null;
    for (const o of this.officers) {
      if (o.dead) continue;
      if (Math.hypot(o.x - px, o.z - pz) < 2.4) { closeOfficer = o; break; }
    }
    if (onFoot && closeOfficer && this.wanted > 0 && player.speed < 2.2) {
      this.bustTimer += dt;
      if (this.bustTimer > 1.6) {
        this.bustTimer = 0;
        if (this.onArrest) this.onArrest();
      }
    } else {
      this.bustTimer = Math.max(0, this.bustTimer - dt * 2);
    }
  }

  updateCruiser(cruiser, dt, player, combat, px, pz) {
    const car = cruiser.car;
    const dx = px - car.x;
    const dz = pz - car.z;
    const dist = Math.hypot(dx, dz);
    const desired = Math.atan2(dx, dz);
    let diff = ((desired - car.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;

    // reverse out if wedged
    if (Math.abs(car.speed) < 1.4) cruiser.stuck += dt; else cruiser.stuck = Math.max(0, cruiser.stuck - dt * 0.6);
    const reversing = cruiser.stuck > 1.1;
    if (reversing && cruiser.stuck > 2.6) cruiser.stuck = 0;

    const throttle = reversing ? -0.8 : (dist > 16 ? 1 : dist > 10 ? 0.55 : 0.1);
    const steer = reversing ? -Math.sign(diff) : Math.max(-1, Math.min(1, diff * 2.2));
    car.drive(dt, throttle, steer, false);
    car.resolveBoxes(this.city.colliders);
    // hard collision with the player's car rams them
    if (player.car && dist < 4.2 && Math.abs(car.speed) > 7) {
      const push = Math.atan2(player.car.x - car.x, player.car.z - car.z);
      player.car.speed += 3.2;
      player.car.x += Math.sin(push) * 0.5;
      player.car.z += Math.cos(push) * 0.5;
      player.hurt(4);
      if (player.car) combat.sparks(player.car.x, 1.0, player.car.z);
    }
    car.updateVisual(dt);

    // officers bail out when the player is on foot and the cruiser is close
    if (!player.car && dist < 26 && cruiser.officersAboard > 0 && this.wanted >= 2) {
      cruiser.officersAboard -= 1;
      this.deployOfficer(car.x, car.z);
    }
    // cruisers shoot at high stars when the player is on foot and exposed
    if (this.wanted >= 3 && !player.car && dist < 34) {
      cruiser.fireCooldown -= dt;
      if (cruiser.fireCooldown <= 0) {
        cruiser.fireCooldown = 1.1 + this.rng.range(0, 0.8);
        this.copShots.push({
          from: { x: car.x, y: 1.4, z: car.z },
          to: { x: px + this.rng.range(-0.6, 0.6), y: 1.1, z: pz + this.rng.range(-0.6, 0.6) },
          t: 0,
        });
        if (this.rng.chance(0.42)) player.hurt(6);
        if (this.onShot) this.onShot();
      }
    }
  }

  deployOfficer(x, z) {
    const rig = new Humanoid({
      skin: this.rng.pick([0xb87a52, 0x8a5433, 0xd9a077]), shirt: 0x24334f, pants: 0x1b2436,
      hair: 0x1a1410, vest: 0x2b3d5c, random: () => this.rng.next(),
    });
    const officer = {
      rig, x: x + this.rng.range(-1.5, 1.5), z: z + this.rng.range(-1.5, 1.5),
      heading: 0, speed: 5.2, hp: 100, dead: false, fireCooldown: this.rng.range(0.6, 1.6), deadT: 0,
    };
    rig.setPosition(officer.x, 0, officer.z);
    this.scene.add(rig.group);
    this.officers.push(officer);
    return officer;
  }

  updateOfficer(officer, dt, player, combat, px, pz) {
    if (officer.dead) {
      officer.deadT += dt;
      officer.rig.update(dt, 0);
      return;
    }
    const dx = px - officer.x;
    const dz = pz - officer.z;
    const dist = Math.hypot(dx, dz);
    const heading = Math.atan2(dx, dz);
    officer.heading = heading;
    officer.rig.setHeading(heading);
    const shooting = dist < 26 && dist > 4;
    if (dist > 6.5) {
      officer.x += (dx / dist) * officer.speed * dt;
      officer.z += (dz / dist) * officer.speed * dt;
    }
    officer.x += this.rng.range(-0.02, 0.02);
    officer.z += this.rng.range(-0.02, 0.02);
    officer.rig.setPosition(officer.x, 0, officer.z);
    officer.rig.update(dt, dist > 6.5 ? officer.speed : 0, { aiming: shooting });
    if (shooting) {
      officer.fireCooldown -= dt;
      if (officer.fireCooldown <= 0) {
        officer.fireCooldown = 0.85 + this.rng.range(0, 0.7);
        const hit = this.rng.chance(0.5);
        this.copShots.push({
          from: { x: officer.x, y: 1.35, z: officer.z },
          to: { x: px + (hit ? 0 : this.rng.range(-1, 1)), y: 1.1, z: pz + (hit ? 0 : this.rng.range(-1, 1)) },
          t: 0,
        });
        if (hit) player.hurt(7);
        if (this.onShot) this.onShot();
      }
    }
    for (const shot of this.copShots) shot.t += dt;
    this.copShots = this.copShots.filter((s) => s.t < 0.09);
  }

  /** Player gunfire can take out an officer. */
  hitOfficer(origin, dir, maxDist) {
    const { raySphere } = this.officerRay;
    let best = null;
    let bestT = maxDist;
    for (const o of this.officers) {
      if (o.dead) continue;
      const t = raySphere(origin, dir, { x: o.x, y: 1.05, z: o.z }, 0.55);
      if (t !== null && t < bestT) { bestT = t; best = o; }
    }
    return best ? { officer: best, t: bestT } : null;
  }

  killOfficer(officer) {
    if (officer.dead) return;
    officer.dead = true;
    officer.deadT = 0;
    officer.rig.die();
    this.addWanted(Math.min(5, this.wanted + 1));
  }

  get officerRay() {
    return { raySphere: (origin, dir, centre, radius) => {
      const ox = origin.x - centre.x, oy = origin.y - centre.y, oz = origin.z - centre.z;
      const b = ox * dir.x + oy * dir.y + oz * dir.z;
      const c = ox * ox + oy * oy + oz * oz - radius * radius;
      const disc = b * b - c;
      if (disc < 0) return null;
      const sq = Math.sqrt(disc);
      const t0 = -b - sq, t1 = -b + sq;
      if (t1 < 0) return null;
      return t0 > 0.1 ? t0 : t1;
    } };
  }
}

/** A little point light that rides the player to make the street feel lamplit at dusk. */
export function createPlayerLamp(scene) {
  const light = new THREE.PointLight(0xffd8a8, 0.6, 14, 2);
  scene.add(light);
  return light;
}
