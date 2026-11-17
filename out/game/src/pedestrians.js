// Pedestrians: a pool of low-poly humans walking the sidewalks ring of each block, plus joggers on
// the promenade. They keep to the pavement, cross at the corners, flinch and run when shots are
// fired or a car is bearing down on them, and drop a little cash when they go down.
import { Humanoid } from './humanoid.js';
import { createRandom } from './rng.js';

export class PedestrianSystem {
  constructor(city, scene, seed = 55) {
    this.city = city;
    this.scene = scene;
    this.rng = createRandom(seed);
    this.peds = [];
    this.spawn();
  }

  spawn() {
    const rng = this.rng;
    const city = this.city;
    const count = 300;
    for (let i = 0; i < count; i += 1) {
      const block = city.blocks[rng.int(0, city.blocks.length - 1)];
      const rig = new Humanoid({ random: () => rng.next() });
      // half the crowd on the promenade for the beach look
      const promenade = rng.chance(0.22);
      const inset = block.half - 1.7;
      const corner = rng.int(0, 3);
      const along = rng.range(-inset, inset);
      const sides = [
        { x: block.x + along, z: block.z - inset, dir: 'x' },
        { x: block.x + inset, z: block.z + along, dir: 'z' },
        { x: block.x + along, z: block.z + inset, dir: 'x' },
        { x: block.x - inset, z: block.z + along, dir: 'z' },
      ];
      const s = promenade
        ? { x: rng.range(-city.maxX, city.maxX), z: city.beachZ + rng.range(2, 10), dir: 'x' }
        : sides[corner];
      const ped = {
        rig,
        x: s.x, z: s.z,
        heading: rng.range(0, Math.PI * 2),
        speed: rng.range(1.1, 1.8),
        walkSpeed: rng.range(1.1, 1.8),
        runSpeed: rng.range(3.6, 5.2),
        panic: 0,
        dead: false,
        deadT: 0,
        loot: rng.chance(0.35) ? rng.int(20, 90) : 0,
        mode: promenade ? 'promenade' : 'block',
        block,
        corner,
        along,
        inset,
        dirSign: rng.chance(0.5) ? 1 : -1,
        phase: rng.range(0, 6.28),
        look: rng.range(0, 6.28),
        armSwing: 0,
      };
      rig.setPosition(ped.x, 0, ped.z);
      rig.setHeading(ped.heading);
      this.scene.add(rig.group);
      this.peds.push(ped);
    }
  }

  panicAt(x, z, radius = 26) {
    for (const ped of this.peds) {
      if (ped.dead) continue;
      const d = Math.hypot(ped.x - x, ped.z - z);
      if (d < radius) {
        ped.panic = Math.max(ped.panic, 4.2 + this.rng.range(0, 2));
        ped.heading = Math.atan2(ped.x - x, ped.z - z);
      }
    }
  }

  update(dt, player) {
    const city = this.city;
    const px = player.car ? player.car.x : player.x;
    const pz = player.car ? player.car.z : player.z;
    for (const ped of this.peds) {
      if (ped.dead) {
        ped.deadT += dt;
        ped.rig.update(dt, 0);
        continue;
      }
      ped.panic = Math.max(0, ped.panic - dt);
      // avoid standing inside a building: nudge back onto the ring
      const speed = ped.panic > 0 ? ped.runSpeed : ped.walkSpeed;

      if (ped.panic > 0) {
        // run away from the player, still respecting walls
        const away = Math.atan2(ped.x - px, ped.z - pz);
        ped.heading = away;
        ped.x += Math.sin(away) * speed * dt;
        ped.z += Math.cos(away) * speed * dt;
      } else if (ped.mode === 'promenade') {
        ped.x += ped.dirSign * speed * dt;
        if (ped.x > city.maxX) { ped.x = city.minX; ped.dirSign = 1; }
        if (ped.x < city.minX) { ped.x = city.maxX; ped.dirSign = -1; }
        ped.heading = ped.dirSign > 0 ? Math.PI / 2 : -Math.PI / 2;
        ped.z += (city.beachZ + 6 - ped.z) * Math.min(1, dt * 0.4) * 0.1;
      } else {
        // walk the block ring: corner by corner
        const b = ped.block;
        const inset = ped.inset;
        const targets = [
          { x: b.x + inset, z: b.z - inset },
          { x: b.x + inset, z: b.z + inset },
          { x: b.x - inset, z: b.z + inset },
          { x: b.x - inset, z: b.z - inset },
        ];
        const t = targets[ped.nextCorner ?? ((ped.corner + 1) % 4)];
        ped.nextCorner = ped.nextCorner ?? ((ped.corner + 1) % 4);
        const dx = t.x - ped.x;
        const dz = t.z - ped.z;
        const d = Math.hypot(dx, dz);
        if (d < 1.6) {
          ped.nextCorner = (ped.nextCorner + 1) % 4;
        } else {
          ped.heading = Math.atan2(dx, dz);
          ped.x += (dx / d) * speed * dt;
          ped.z += (dz / d) * speed * dt;
        }
        // step off the sidewalk into the crosswalk now and then, straight across the block
        if (!ped.crossing && this.rng.chance(0.0009)) {
          ped.crossing = { x: b.x + (this.rng.chance(0.5) ? 1 : -1) * (b.half + 12), z: ped.z };
        }
        if (ped.crossing) {
          const cdx = ped.crossing.x - ped.x;
          const cdz = ped.crossing.z - ped.z;
          const cd = Math.hypot(cdx, cdz);
          if (cd < 1.5) ped.crossing = null;
          else {
            ped.heading = Math.atan2(cdx, cdz);
            ped.x += (cdx / cd) * speed * dt;
            ped.z += (cdz / cd) * speed * dt;
          }
        }
      }

      // look toward a nearby player when idle-ish
      const dist = Math.hypot(ped.x - px, ped.z - pz);
      if (dist < 9 && ped.panic <= 0) {
        ped.heading = Math.atan2(px - ped.x, pz - ped.z);
      }
      // keep out of buildings and off the kerb edges
      ped.rig.setPosition(ped.x, 0, ped.z);
      ped.rig.setHeading(ped.heading);
      ped.rig.update(dt, speed);
    }
  }

  /** Nearest live pedestrian in front of a ray: used by gunfire. */
  hitTest(origin, dir, maxDist) {
    let best = null;
    let bestT = maxDist;
    for (const ped of this.peds) {
      if (ped.dead) continue;
      const t = raySphere(origin, dir, { x: ped.x, y: 1.1, z: ped.z }, 0.62);
      if (t !== null && t < bestT) { bestT = t; best = ped; }
    }
    return best ? { ped: best, t: bestT } : null;
  }

  kill(ped) {
    if (ped.dead) return;
    ped.dead = true;
    ped.deadT = 0;
    ped.rig.die();
  }

  liveCount() { return this.peds.filter((p) => !p.dead).length; }
}

export function raySphere(origin, dir, centre, radius) {
  const ox = origin.x - centre.x;
  const oy = origin.y - centre.y;
  const oz = origin.z - centre.z;
  const b = ox * dir.x + oy * dir.y + oz * dir.z;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  const t0 = -b - sq;
  const t1 = -b + sq;
  if (t1 < 0) return null;
  return t0 > 0.1 ? t0 : t1;
}
