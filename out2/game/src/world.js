// The world wrapper: city geometry, collision, water and ground queries, plus the
// frame clock the rest of the game reads. Nothing here renders; main.js owns the
// draw order.

import { CITY, CLOCK, SKY, SUN } from './config.js';
import { generateCity } from './city.js';
import { clamp } from './math3d.js';
import { makeRng } from './rng.js';

export class World {
  constructor(seed = 20261117) {
    this.seed = seed;
    this.city = generateCity();
    this.colliders = this.city.colliders;
    this.landmarks = this.city.landmarks;
    this.time = 0;
    this.clock = CLOCK.startHour;
    this.rng = makeRng(seed ^ 0x51ed);
    this.decals = [];
    this.tracers = [];
    this.sparks = [];
    this.floaters = [];
    this.timeOfDayDirty = true;
    this.waterY = -0.35;
    this.rain = 0;
  }

  update(dt) {
    this.time += dt;
    this.clock = (CLOCK.startHour + this.time / CLOCK.secondsPerHour) % 24;
    // effects decay
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i];
      d.life -= dt;
      if (d.life <= 0) this.decals.splice(i, 1);
    }
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      if (t.life <= 0) this.tracers.splice(i, 1);
    }
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life -= dt;
      s.vy -= 9 * dt;
      s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      if (s.life <= 0) this.sparks.splice(i, 1);
    }
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.life -= dt;
      f.y += dt * 1.2;
      if (f.life <= 0) this.floaters.splice(i, 1);
    }
  }

  // Height of whatever you'd stand on at x,z: road 0, pavement, sand, pier.
  groundAt(x, z) {
    const c = this.city;
    if (Math.abs(x) > c.landHalf || Math.abs(z) > c.landHalf) {
      // the sand strip reaches further south, the pier further east
      if (z > c.beachZ - 2 && z < c.beachZ + 145 && Math.abs(x) < 380) return 0.06;
      if (x > c.landHalf && x < c.landHalf + 26 && z > -170 && z < 50) return 0.7;
      return this.waterY - 1.2;
    }
    // pavement: inside a block footprint (see generateCity's slab width)
    const pitch = CITY.pitch;
    const localX = ((x + CITY.half) % pitch + pitch) % pitch;
    const localZ = ((z + CITY.half) % pitch + pitch) % pitch;
    const lo = CITY.road / 2 - 1.4;
    const hi = pitch - CITY.road / 2 + 1.4;
    if (localX > lo && localX < hi && localZ > lo && localZ < hi) return CITY.curb;
    return 0;
  }

  isWater(x, z) {
    if (this.groundAt(x, z) > this.waterY - 0.05) return false;
    return true;
  }

  fmtClock() {
    const h = Math.floor(this.clock) % 24;
    const m = Math.floor((this.clock % 1) * 60);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hh = h % 12 === 0 ? 12 : h % 12;
    return `${hh}:${String(m).padStart(2, '0')} ${ampm}`;
  }

  // Sun colour/height: warm at dawn and dusk, white at noon, blue at night.
  skyTint() {
    const h = this.clock;
    const day = clamp(Math.sin(((h - 5.6) / 24) * Math.PI * 2) * 0.5 + 0.5, 0, 1);
    const dusk = Math.exp(-Math.pow((h - 18.4) / 1.9, 2));
    const dawn = Math.exp(-Math.pow((h - 6.3) / 1.7, 2));
    return { day, dusk, dawn, night: 1 - day };
  }

  addTracer(a, b, color = [1.0, 0.86, 0.5]) {
    this.tracers.push({ a, b, life: 0.055, color });
  }
  addSpark(x, y, z, n = 4, color = [1.0, 0.7, 0.3]) {
    for (let i = 0; i < n; i++) {
      this.sparks.push({
        x, y, z,
        vx: (this.rng() - 0.5) * 5,
        vy: this.rng() * 3.5,
        vz: (this.rng() - 0.5) * 5,
        life: 0.28 + this.rng() * 0.3,
        color,
      });
    }
  }
  addDecal(x, z, r, color = [0.05, 0.05, 0.06], life = 22) {
    this.decals.push({ x, z, r, color, life, max: life });
  }
  addFloater(x, y, z, text, color = [1, 0.86, 0.4]) {
    this.floaters.push({ x, y, z, text, color, life: 1.1, max: 1.1 });
  }
}

// A cheap ray/box test used for bullets against buildings.
export function rayBox(origin, dir, box, maxT) {
  let tmin = 0, tmax = maxT;
  const o = origin, d = dir;
  const lo = [box.minx, 0, box.minz];
  const hi = [box.maxx, box.h, box.maxz];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-7) {
      if (o[i] < lo[i] || o[i] > hi[i]) return null;
    } else {
      const inv = 1 / d[i];
      let t1 = (lo[i] - o[i]) * inv;
      let t2 = (hi[i] - o[i]) * inv;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}
