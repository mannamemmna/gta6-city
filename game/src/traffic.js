// Traffic: cars drive the grid in the right-hand lane for their direction, queue behind each
// other, and turn only at intersections, with the lane offset blended so the path reads as a curve
// rather than a jump. Parked cars line the kerbs and are stealable. Traffic and parked cars are the
// same Car class; only `route` distinguishes a moving car from a stationary one.
import { Car } from './vehicles.js';
import { createRandom } from './rng.js';

const LANE = 4.7;            // metres from the centre line to a lane's centre
const TRAFFIC_MODELS = ['sabueso', 'burro', 'gaviota', 'taxico', 'furgon'];
const CAR_COLORS = [0xd94f3d, 0x2f6f8a, 0xe8d9b0, 0x8a3f5f, 0x3f5f4a, 0xd8a03c, 0xf0ece0, 0x4a4f56, 0x9a5a2a, 0x6a3fa0, 0xb8c4c8];

export class TrafficSystem {
  constructor(city, scene, seed = 91) {
    this.city = city;
    this.scene = scene;
    this.rng = createRandom(seed);
    this.cars = [];
    this.parked = [];
    this.lane = LANE;
    this.spawnParked();
    this.spawnTraffic();
  }

  spawnParked() {
    const rng = this.rng;
    for (const spot of this.city.parkedSpots) {
      if (!rng.chance(0.82)) continue;
      const model = rng.pick(TRAFFIC_MODELS);
      const car = new Car(model, {
        x: spot.x, z: spot.z, heading: spot.heading,
        color: model === 'taxico' ? 0xe8b53d : rng.pick(CAR_COLORS),
      });
      car.parked = true;
      car.group.userData.car = car;
      this.scene.add(car.group);
      this.parked.push(car);
      this.cars.push(car);
    }
  }

  spawnTraffic() {
    const rng = this.rng;
    const { roadX, roadZ } = this.city;
    const count = 120;
    for (let i = 0; i < count; i += 1) {
      const onZRoad = rng.chance(0.5);
      const lines = onZRoad ? roadZ : roadX;
      const lineIndex = rng.int(0, lines.length - 1);
      const line = lines[lineIndex];
      const dir = rng.chance(0.5) ? 1 : -1;
      const t = rng.range(-0.88, 0.88);
      const free = onZRoad ? t * this.city.maxZ : t * this.city.maxX;
      const lane = this.laneFor(onZRoad ? 'z' : 'x', dir);
      const model = rng.pick(TRAFFIC_MODELS);
      const car = new Car(model, {
        x: onZRoad ? line + lane.x : free,
        z: onZRoad ? free : line + lane.z,
        heading: onZRoad ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2),
        color: model === 'taxico' ? 0xe8b53d : rng.pick(CAR_COLORS),
        ai: 'traffic',
      });
      car.route = {
        axis: onZRoad ? 'z' : 'x',
        lineIndex,
        line,
        dir,
        speed: rng.range(6, 11),
        cruise: rng.range(8, 14),
        lastJunction: -99,
      };
      car.group.userData.car = car;
      this.scene.add(car.group);
      this.cars.push(car);
    }
  }

  /** Lane centre offset from a road centre line for a direction on an axis (right-hand traffic). */
  laneFor(axis, dir) {
    return axis === 'z' ? { x: -LANE * dir, z: 0 } : { x: 0, z: LANE * dir };
  }

  carAhead(car) {
    const r = car.route;
    let best = null;
    let bestDist = Infinity;
    for (const other of this.cars) {
      if (other === car || !other.route) continue;
      const o = other.route;
      if (o.axis !== r.axis || o.lineIndex !== r.lineIndex || o.dir !== r.dir) continue;
      const d = r.axis === 'z' ? (other.z - car.z) * r.dir : (other.x - car.x) * r.dir;
      if (d > 0.4 && d < bestDist) { bestDist = d; best = other; }
    }
    return { car: best, dist: bestDist };
  }

  update(dt, player) {
    const { roadX, roadZ } = this.city;
    const px = player.car ? player.car.x : player.x;
    const pz = player.car ? player.car.z : player.z;
    for (const car of this.cars) {
      if (!car.route || car.occupant) continue;
      const r = car.route;
      const lane = this.laneFor(r.axis, r.dir);

      // speed: queue behind the next car and yield to the player standing in the road
      let want = r.cruise;
      const ahead = this.carAhead(car);
      if (ahead.car && ahead.dist < 16) want = Math.max(0, (ahead.dist - 7) * 1.5);
      const along = r.axis === 'z' ? (pz - car.z) * r.dir : (px - car.x) * r.dir;
      const lateral = r.axis === 'z' ? Math.abs(px - car.x) : Math.abs(pz - car.z);
      if (along > 0 && along < 13 && lateral < 3.2) want = Math.max(0, (along - 5) * 1.8);
      r.speed += (want - r.speed) * Math.min(1, dt * 2.4);
      r.speed = Math.max(0, r.speed);

      // turning: only inside a junction box, and only sometimes
      const lines = r.axis === 'z' ? roadZ : roadX;
      const coord = r.axis === 'z' ? car.z : car.x;
      for (let j = 0; j < lines.length; j += 1) {
        const delta = (coord - lines[j]) * r.dir;
        if (delta > -2.6 && delta < 2.6 && j !== r.lastJunction && this.rng.chance(0.26)) {
          r.lastJunction = j;
          const newAxis = r.axis === 'z' ? 'x' : 'z';
          const newLines = newAxis === 'z' ? roadX : roadZ;
          const newIdx = this.rng.int(0, newLines.length - 1);
          r.line = newLines[newIdx];
          r.dir = this.rng.chance(0.5) ? 1 : -1;
          if (newAxis === 'z') car.z = r.line; else car.x = r.line;
          r.axis = newAxis;
          r.lineIndex = newIdx;
          break;
        }
      }

      // advance along the current axis and settle sideways into the lane
      if (r.axis === 'z') {
        car.z += r.speed * r.dir * dt;
        car.x += (r.line + lane.x - car.x) * Math.min(1, dt * 2.4);
      } else {
        car.x += r.speed * r.dir * dt;
        car.z += (r.line + lane.z - car.z) * Math.min(1, dt * 2.4);
      }

      // wrap at the map edges
      if (r.axis === 'z') {
        if (car.z > this.city.beachZ + 2 && r.dir > 0) car.z = this.city.minZ + 2;
        if (car.z < this.city.minZ - 2 && r.dir < 0) car.z = this.city.beachZ - 2;
      } else {
        if (car.x > this.city.maxX + 2 && r.dir > 0) car.x = this.city.minX + 2;
        if (car.x < this.city.minX - 2 && r.dir < 0) car.x = this.city.maxX - 2;
      }

      // heading follows the lane direction, smoothly
      const wantHeading = r.axis === 'z' ? (r.dir > 0 ? 0 : Math.PI) : (r.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
      const diff = ((wantHeading - car.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      car.heading += diff * Math.min(1, dt * 4.5);
      car.steer = Math.max(-1, Math.min(1, diff * 1.3));
      car.speed = r.speed;
      car.brakeLight = r.speed < 1.4;
      car.updateVisual(dt);
    }

    // keep traffic out of the player's car
    if (player.car) {
      const pc = player.car;
      for (const car of this.cars) {
        if (car === pc || car.occupant) continue;
        const d = Math.hypot(car.x - pc.x, car.z - pc.z);
        if (d < 3.2 && d > 0.01) {
          const nx = (car.x - pc.x) / d;
          const nz = (car.z - pc.z) / d;
          car.x += nx * (3.2 - d) * 0.5;
          car.z += nz * (3.2 - d) * 0.5;
          if (car.route) car.route.speed *= 0.4;
        }
      }
    }
  }

  removeCar(car) {
    const i = this.cars.indexOf(car);
    if (i >= 0) this.cars.splice(i, 1);
    const j = this.parked.indexOf(car);
    if (j >= 0) this.parked.splice(j, 1);
    this.scene.remove(car.group);
    car.dispose();
  }

  /** Nearest unoccupied car within `radius` of a point, for the steal prompt. */
  nearestCar(x, z, radius = 4.0) {
    let best = null;
    let bestD = radius;
    for (const car of this.cars) {
      if (car.occupant) continue;
      const d = Math.hypot(car.x - x, car.z - z);
      if (d < bestD) { bestD = d; best = car; }
    }
    return best;
  }
}

export function lerpAngle(a, b, t) {
  const diff = ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return a + diff * t;
}
