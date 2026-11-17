// Screenshot staging: each ?shot= name builds an honest game state — real cars on the road, real
// pedestrians on the pavement, a real mission running, a real wanted level with cruisers closing —
// then leaves the normal loop to render it. Nothing here paints a fake overlay: it only moves the
// simulation to a photogenic moment and opens the HUD element that belongs to that moment.
import { Car } from './vehicles.js';

function placeCar(game, model, x, z, heading, color) {
  const car = new Car(model, { x, z, heading, color });
  car.group.userData.car = car;
  car.parked = true;
  game.scene.add(car.group);
  game.traffic.cars.push(car);
  game.traffic.parked.push(car);
  return car;
}

function enter(game, car) {
  game.player.car = car;
  car.occupant = 'player';
  car.parked = false;
  game.player.x = car.x;
  game.player.z = car.z;
  game.player.heading = car.heading;
  game.player.rig.group.position.set(car.x, 0, car.z);
  game.player.rig.group.rotation.y = car.heading;
  game.cam.yaw = car.heading + Math.PI;
  game.cam.pitch = 0.12;
}

/** Steps the simulation forward without input so the street has believable motion frozen into it. */
function settle(game, seconds) {
  const dt = 1 / 60;
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i += 1) {
    game.traffic.update(dt, game.player);
    game.peds.update(dt, game.player);
    if (game.police.wanted > 0) game.police.update(dt, game.player, game.combat, null);
    game.combat.update(dt);
  }
}

/** Moves a ring of pedestrians onto the pavement around a point, facing roughly inward. */
function crowdAround(game, x, z, radius, count) {
  let placed = 0;
  for (const ped of game.peds.peds) {
    if (placed >= count) break;
    if (ped.dead) continue;
    const a = (placed / count) * Math.PI * 2 + 0.35;
    const r = radius * (0.5 + ((placed * 7) % 11) / 22);
    ped.x = x + Math.cos(a) * r;
    ped.z = z + Math.sin(a) * r * 0.62;
    ped.heading = Math.atan2(x - ped.x, z - ped.z) + Math.PI;
    ped.panic = 0;
    ped.crossing = null;
    ped.rig.setPosition(ped.x, 0, ped.z);
    ped.rig.setHeading(ped.heading);
    ped.rig.update(1 / 60, 0.9);
    placed += 1;
  }
}

/** Parks a line of static cars into the shot so the street is never empty. */
function lineCars(game, x0, z0, dx, dz, count, models = ['sabueso', 'burro', 'taxico', 'furgon']) {
  const colors = [0x2f6f8a, 0xe8d9b0, 0x3f5f4a, 0xd8a03c, 0x8a3f5f, 0xf0ece0];
  for (let i = 0; i < count; i += 1) {
    const model = models[i % models.length];
    placeCar(game, model, x0 + dx * i, z0 + dz * i,
      Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? Math.PI / 2 : -Math.PI / 2) : (dz > 0 ? 0 : Math.PI),
      colors[i % colors.length]);
  }
}

export function stageShot(name, game, ctx) {
  const { hud, cam } = ctx;
  const { player } = game;

  switch (name) {
    case 'cover': {
      // The cover: the chase, because it puts the most systems in one frame. Stolen convertible at
      // speed, three cruisers with bars lit, three stars, minimap with blips, speedometer, a crowded
      // pavement, traffic both ways, and the mission card. Low camera to sell speed and scale.
      game.env.setTimeOfDay('golden');
      const car = placeCar(game, 'gaviota', 18, 116, Math.PI * 0.5, 0xd94f3d);
      enter(game, car);
      car.speed = 26;
      car.updateVisual(1 / 60);
      game.missions.index = 0;
      game.missions.start(0);
      game.missions.step = 1;
      game.missions.setStepMarker(1);
      game.missions.onSay(null, null);
      game.police.setWanted(3);
      game.police.playerRef = player;
      // Civilian traffic first, so the avenue is busy on both sides.
      lineCars(game, 52, 124, 9, 0, 4, ['sabueso', 'burro', 'taxico', 'furgon']);
      lineCars(game, 26, 100, -11, 0, 3, ['gaviota', 'sabueso', 'taxico']);
      lineCars(game, -6, 140, 7, 0, 3, ['burro', 'furgon', 'gaviota']);
      crowdAround(game, 4, 106, 11, 14);
      crowdAround(game, 30, 126, 9, 8);
      settle(game, 0.7);
      // Cruisers last, as parked props on the avenue behind and beside the player, so the pursuit
      // AI cannot drive them out of frame before the capture.
      // The chase camera sits behind the car looking along +x, so the cruisers are staged ahead of
      // it: one close on the left, one mid-distance on the right facing back, one far on the left.
      // Close enough to read as cruisers, spread left/right so they sit below the mission title
      // card instead of behind it.
      const copSpots = [
        { x: car.x + 10, z: car.z - 2.6, h: car.heading + Math.PI },
        { x: car.x + 17, z: car.z + 3.2, h: car.heading + Math.PI },
        { x: car.x + 26, z: car.z - 4.4, h: car.heading + Math.PI },
      ];
      for (const spot of copSpots) {
        // Built straight into the scene, never registered with the traffic system, so nothing
        // repositions them after this line.
        const cop = new Car('patrulla', { x: spot.x, z: spot.z, heading: spot.h, color: 0xf0ece0 });
        cop.police = true;
        cop.sirenOn = true;
        cop.parked = true;
        cop.group.userData.car = cop;
        cop.group.position.set(spot.x, 0, spot.z);
        cop.group.rotation.y = spot.h;
        cop.updateVisual(1 / 60);
        game.scene.add(cop.group);
      }
      game.player.money = 1840;
      // Low, close chase camera: the cruisers read at car size instead of dissolving into the road.
      game.cam.yaw = car.heading + Math.PI;
      game.cam.pitch = 0.06;
      game.cam.distance = 6.4;
      game.cam.targetDistance = 6.4;
      hud.toast('WANTED — three stars', 120);
      hud.prompt('');
      break;
    }
    case 'driving': {
      // The chase shot: three stars, three cruisers on the boulevard, the stolen convertible.
      game.env.setTimeOfDay('golden');
      const car = placeCar(game, 'gaviota', 20, 118, Math.PI * 0.5, 0xd94f3d);
      enter(game, car);
      car.speed = 22;
      car.updateVisual(1 / 60);
      game.missions.index = 0;
      game.missions.start(0);
      game.missions.step = 1;
      game.missions.setStepMarker(1);
      game.missions.onSay(null, null);
      game.police.setWanted(3);
      game.police.playerRef = player;
      for (let i = 0; i < 3; i += 1) {
        const c = game.police.spawnCruiser(false);
        if (!c) break;
        c.car.x = car.x - 10 - i * 9.5;
        c.car.z = car.z - 3.4 + (i % 2) * 6.2;
        c.car.heading = car.heading + (i === 1 ? 0.07 : -0.05);
        c.car.speed = 18 + i * 2;
        c.car.updateVisual(1 / 60);
      }
      lineCars(game, 62, 122, 8, 0, 3);
      crowdAround(game, 10, 104, 9, 5);
      settle(game, 0.6);
      game.player.money = 1840;
      hud.banner('MISSION 1', 'Bad Debts', 90);
      hud.toast('WANTED — three stars', 90);
      hud.prompt('');
      break;
    }
    case 'mission': {
      // A firefight on the pier at dusk: mission 2 mid-objective, the crew closing, low ammo.
      game.env.setTimeOfDay('dusk');
      game.missions.index = 1;
      game.missions.start(1);
      game.missions.step = 1;
      game.missions.setStepMarker(1);
      const p = game.player;
      p.place(-26, 240, Math.PI * 0.06);
      p.armor = 55;
      p.health = 71;
      p.ammo = 6;
      cam.yaw = Math.PI * 0.02;
      cam.pitch = 0.09;
      cam.distance = 4.0;
      game.missions.onSay(null, null);
      game.missions.spawnEnemies([
        { x: -32, z: 250 }, { x: -19, z: 251 }, { x: -27, z: 259 }, { x: -16, z: 257 },
      ]);
      for (const e of game.missions.enemies) e.rig.setHeading(Math.PI);
      settle(game, 1.4);
      for (const e of game.missions.enemies) {
        e.heading = Math.atan2(p.x - e.x, p.z - e.z);
        e.rig.setHeading(e.heading);
        e.rig.update(1 / 60, 0, { aiming: true });
      }
      game.police.setWanted(1);
      game.player.money = 2410;
      hud.banner('MISSION 2', 'Salt and Ashes', 90);
      hud.say('MARISOL', 'The case. The ledger. And nobody follows me off this pier.');
      hud.toast('4 hostiles — clear the pier', 90);
      hud.prompt('');
      break;
    }
    case 'vista': {
      // The wide shot: golden hour over the bay, the downtown wall, traffic on the grid.
      game.env.setTimeOfDay('golden');
      player.place(-6, 168, Math.PI);
      settle(game, 6.0);
      game.cam.override = { pos: { x: 96, y: 44, z: 188 }, look: { x: -20, y: 26, z: -90 } };
      hud.banner('', '', 0.01);
      hud.say(null, null);
      hud.prompt('');
      break;
    }
    case 'title': {
      player.place(-30, 34, Math.PI);
      settle(game, 4);
      game.cam.override = { pos: { x: 44, y: 26, z: 96 }, look: { x: -16, y: 12, z: -30 } };
      break;
    }
    default:
      break;
  }
}

export { settle, placeCar, enter, crowdAround, lineCars };
