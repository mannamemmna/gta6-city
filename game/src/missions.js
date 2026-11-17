// The story of Cobalt Bay: eleven beats that take Ren Okonkwo from a borrowed
// courier job to the top of the bay. Each mission is a small state machine with a
// marker, an objective line, optional timers and fail conditions; finishing one
// pays, unlocks the next, and moves the city's attitude to you.

import { COP, MONEY, VEHICLES } from './config.js';
import { Vehicle, vehicleSpec } from './vehicles.js';
import { drawPerson } from './models.js';

export const MISSIONS = [
  {
    id: 'm1', title: 'Saltwater Cure', who: 'Dovie Marsh',
    kicker: 'Job 01 · The Docks',
    body: 'Dovie keeps the marina books and a bar tab nobody settles. Her nephew owes the Ferro crew four thousand and a car. Go get the car back — Pier Nine, the blue Cormorant under the gantry. Do not bring it back scratched.',
    reward: 320, at: 'warehouse',
    steps: [
      { type: 'goto', target: 'car', text: 'Find the blue Cormorant at Pier Nine', radius: 6 },
      { type: 'deliver', target: 'warehouse', text: 'Drive the Cormorant to Ferro Yards', radius: 9, vehicle: true },
    ],
    onStart: (game) => {
      const spot = game.world.landmarks.warehouse;
      const car = new Vehicle(game.world, vehicleSpec('cormorant'), spot[0] - 10, spot[1] + 16, 0);
      car.color = [0.13, 0.32, 0.46];
      car.parked = true;
      car.missionCar = true;
      car.health = 88;
      game.vehicles.push(car);
      game.missionActor = car;
      game.marker = { x: car.x, z: car.z };
      game.missionText = 'The Cormorant is parked by the container stacks.';
    },
    tick: (game, m) => {
      const car = game.missionActor;
      if (!car) return;
      if (m.step === 0) {
        game.marker = { x: car.x, z: car.z };
        if (car.driver === 'player') m.step = 1;
      } else if (m.step === 1) {
        // once stolen, the marker follows the yard
        const spot = game.world.landmarks.warehouse;
        game.marker = { x: spot[0] - 10, z: spot[1] + 16 };
        if (car.dead) return game.failMission('The Cormorant is wrecked.');
        if (car.driver !== 'player') return; // parked again, fine
        const d = Math.hypot(car.x - game.marker.x, car.z - game.marker.z);
        if (d < 10 && car.speed < 4) {
          game.completeMission();
        }
      }
    },
    outro: 'Dovie pays in cash from a biscuit tin. "The Ferro brothers want their money by Sunday, and they want it counted in front of them. That\'s the next conversation."',
  },
  {
    id: 'm2', title: 'Count It Twice', who: 'Dovie Marsh',
    kicker: 'Job 02 · Lantern Row',
    body: 'The Ferro crew holds court at the Lantern Club at the north end of Lantern Row. Carry the four thousand in, keep your hands where they can see them, and walk out with a signature. Bring the money — and no police.',
    unlock: ['m1'],
    reward: 420, at: 'club',
    steps: [
      { type: 'goto', target: 'bank', radius: 5, text: 'Collect the envelope from the Cobalt Trust' },
      { type: 'vehicle', text: 'Drive to the Lantern Club, east on Lantern Row' },
      { type: 'goto', target: 'club', radius: 7, text: 'Walk into the Lantern Club' },
      { type: 'survive', seconds: 3, text: 'Watch the count. Nobody leaves early.' },
    ],
    onStart: (game) => {
      game.marker = { x: game.world.landmarks.bank[0] + 8, z: game.world.landmarks.bank[1] - 8 };
      game.missionText = 'Dovie hands you an envelope fat with cash.';
      game.flags.hasMoney = false;
    },
    tick: (game, m) => {
      const lm = game.world.landmarks;
      const p = game.player;
      if (m.step === 0) {
        game.marker = { x: lm.bank[0] + 8, z: lm.bank[1] - 8 };
        if (Math.hypot(p.x - game.marker.x, p.z - game.marker.z) < 6) {
          m.step = 1;
          game.flags.hasMoney = true;
          game.hud.toast('Envelope collected · $4,000', 'good');
          game.marker = { x: lm.club[0], z: lm.club[1] };
        }
      } else if (m.step === 1) {
        game.marker = { x: lm.club[0], z: lm.club[1] };
        const d = Math.hypot(p.x - game.marker.x, p.z - game.marker.z);
        if (d < 70 && p.vehicle) m.step = 2;
        else if (d < 40 && !p.vehicle) m.step = 2;
        if (game.police.level >= 2) return game.failMission('The police ran you down with the envelope.');
      } else if (m.step === 2) {
        game.marker = { x: lm.club[0], z: lm.club[1] };
        if (!p.vehicle && Math.hypot(p.x - lm.club[0], p.z - lm.club[1]) < 9) {
          m.step = 3;
          m.timer = 0;
          game.audio.stinger();
          game.hud.toast('Nardo Ferro counts it once, then again.', 'info');
        }
      } else if (m.step === 3) {
        m.timer = (m.timer ?? 0) + game.dt;
        game.marker = null;
        if (m.timer > 3.2) {
          game.completeMission();
        }
      }
      if (m.step < 2 && game.police.level >= 3) return game.failMission('Too hot with the money on you.');
    },
    outro: 'Nardo signs the pay slip with a lighter held to the page. "You ran the envelope. Sunday you run something that moves."',
  },
  {
    id: 'm3', title: 'Two Lanes', who: 'Nardo Ferro',
    kicker: 'Job 03 · Solana Strip',
    body: 'A Skua RS is parked behind the Solana casino with a dead man\'s key in it. Nardo wants it on the quay at Pier Nine before the tide turns, and he wants it delivered clean. The bay takes four minutes if you drive it like you mean it.',
    unlock: ['m2'],
    reward: 560, at: 'casino',
    steps: [
      { type: 'goto', target: 'casino', radius: 7, text: 'Take the Skua RS from behind the casino' },
      { type: 'goto', target: 'pier', radius: 12, text: 'Deliver it to Pier Nine inside 75 seconds', timer: 75 },
    ],
    onStart: (game) => {
      const lm = game.world.landmarks;
      const car = new Vehicle(game.world, vehicleSpec('skua'), lm.casino[0] + 14, lm.casino[1] - 6, 1.4);
      car.parked = true;
      car.missionCar = true;
      game.vehicles.push(car);
      game.missionActor = car;
      game.marker = { x: car.x, z: car.z };
      m_state(game, 'm3').timer = 75;
    },
    tick: (game, m) => {
      const car = game.missionActor;
      const lm = game.world.landmarks;
      if (!car) return;
      if (m.step === 0) {
        game.marker = { x: car.x, z: car.z };
        if (car.driver === 'player') {
          m.step = 1;
          m.timer = 75;
          game.audio.stinger();
          game.hud.toast('75 seconds. Go.', 'warn');
        }
      } else {
        m.timer -= game.dt;
        const pier = { x: game.world.city.landmarks.warehouse[0] + 26, z: -30 };
        game.marker = pier;
        const d = Math.hypot(car.x - pier.x, car.z - pier.z);
        if (d < 16 && car.speed < 6) return game.completeMission();
        if (m.timer <= 0) return game.failMission('The tide turned without you.');
        if (car.dead) return game.failMission('The Skua is a fireball.');
      }
    },
    outro: 'Nardo does not say thank you. He writes a number on a napkin: five hundred and change. "Sunday. The casino. Bring something with a heartbeat."',
  },
  {
    id: 'm4', title: 'House Cut', who: 'Yara Pell',
    kicker: 'Job 04 · The Solana Casino',
    body: 'Yara runs the cage at the Solana. Three men will walk the floor at nine with the week\'s take in canvas bags. She wants the bags and the floor manager\'s ledger, and she does not want anyone calling the front desk. Go loud if you have to. Come back with the money either way.',
    unlock: ['m3'],
    reward: 900, at: 'casino',
    steps: [
      { type: 'goto', target: 'casino', radius: 8, text: 'Get to the Solana floor at nine' },
      { type: 'kill', count: 3, text: 'Take down the three bagmen' },
      { type: 'escape', radius: 120, text: 'Lose the police and get clear of the Strip' },
    ],
    onStart: (game) => {
      const lm = game.world.landmarks;
      game.spawnBagsmen(lm.casino[0] + 6, lm.casino[1] - 8, 3);
      m_state(game, 'm4').kills = 0;
      game.marker = { x: lm.casino[0] + 6, z: lm.casino[1] - 8 };
      game.hud.toast('Three bagmen on the floor. Keep it quick.', 'warn');
    },
    tick: (game, m) => {
      const alive = game.bagsmen.filter((b) => !b.dead);
      if (m.step === 0) {
        const d = Math.hypot(game.player.x - game.marker.x, game.player.z - game.marker.z);
        if (d < 14) m.step = 1;
      } else if (m.step === 1) {
        game.marker = null;
        if (!alive.length) {
          m.step = 2;
          game.missionKills = (game.missionKills ?? 0) + 3;
          game.player.money += 1200;
          game.hud.toast('Bags secured · $1,200', 'good');
          game.police.crime('robbery', 2.2);
          game.audio.cash();
          game.marker = { x: game.player.x + 180, z: game.player.z };
        }
      } else if (m.step === 2) {
        // marker pushes you toward the map edge, away from the casino
        game.marker = { x: game.player.x + (game.player.x - 0 ? 1 : 1) * 0, z: 0 };
        const lm = game.world.landmarks;
        const away = Math.atan2(game.player.x - lm.casino[0], game.player.z - lm.casino[1]);
        game.marker = {
          x: game.player.x + Math.sin(away) * 60,
          z: game.player.z + Math.cos(away) * 60,
        };
        const d = Math.hypot(game.player.x - lm.casino[0], game.player.z - lm.casino[1]);
        if (d > 190 && game.police.level === 0) return game.completeMission();
        if (game.player.dead) return game.failMission('You bled out on the carpet.');
      }
    },
    outro: 'Yara counts the take twice and peels off your end without looking up. "You are not a courier any more. That is going to cost you."',
  },
  {
    id: 'm5', title: 'Rooftop Runner', who: 'Dovie Marsh',
    kicker: 'Job 05 · Cobalt Heights',
    body: 'The Cobalt Trust keeps a hard drive on the 74th floor and Dovie keeps a grudge. The service stair ends at the roof of the trust\'s annex. Get up, get the drive, and get off the roof before the helicopter light finds you.',
    unlock: ['m4'],
    reward: 1150, at: 'bank',
    steps: [
      { type: 'goto', target: 'bank', radius: 10, text: 'Reach the Cobalt Trust annex' },
      { type: 'survive', seconds: 8, text: 'Hold the annex roof while the drive copies' },
      { type: 'goto', target: 'garage', radius: 12, text: 'Get back to the garage with the drive' },
    ],
    onStart: (game) => {
      const lm = game.world.landmarks;
      game.marker = { x: lm.bank[0] + 14, z: lm.bank[1] + 14 };
      m_state(game, 'm5').copWave = 0;
      game.hud.toast('Trust annex · roof service stair', 'info');
    },
    tick: (game, m) => {
      const lm = game.world.landmarks;
      const p = game.player;
      if (m.step === 0) {
        game.marker = { x: lm.bank[0] + 14, z: lm.bank[1] + 14 };
        if (Math.hypot(p.x - game.marker.x, p.z - game.marker.z) < 12) {
          m.step = 1; m.timer = 0;
          game.spawnGuardWave(lm.bank[0] + 12, lm.bank[1] + 8, 3);
          game.hud.toast('Copying. Two minutes of company.', 'warn');
          game.police.crime('trespass', 1.0);
        }
      } else if (m.step === 1) {
        m.timer += game.dt;
        game.marker = null;
        const alive = game.guards.filter((g) => !g.dead).length;
        if (m.timer > 8 && alive <= 0) {
          m.step = 2;
          game.marker = { x: lm.garage[0], z: lm.garage[1] };
          game.hud.toast('Drive copied. Garage, north-west.', 'good');
        } else if (m.timer > 8 && alive > 0) {
          // more company to keep the roof hot
          if (m.timer > (m.next === undefined ? 0 : m.next) + 14) {
            m.next = m.timer;
            game.spawnGuardWave(lm.bank[0] + 16, lm.bank[1] + 20, 2);
          }
        }
        if (p.dead) return game.failMission('The roof of the annex, and a long way down.');
      } else {
        game.marker = { x: lm.garage[0], z: lm.garage[1] };
        if (Math.hypot(p.x - lm.garage[0], p.z - lm.garage[1]) < 14) game.completeMission();
        if (p.dead) return game.failMission('Wasted with the drive in your jacket.');
      }
    },
    outro: 'The drive is warm in your jacket. Dovie plugs it in and whistles. "Payroll for half the bay, and a name on every line. That name is Nardo\'s. Oh, honey."',
  },
  {
    id: 'm6', title: 'Dead Man in the Bay', who: 'Yara Pell',
    kicker: 'Job 06 · Pier Nine',
    body: 'Nardo\'s money is not Nardo\'s. It is Yara\'s, and it has been for six years. She wants him gone by morning and the docks empty of his crew when the cranes start. Bring the shotgun. The pier is long and nobody will hear it.',
    unlock: ['m5'],
    reward: 1600, at: 'pier',
    steps: [
      { type: 'goto', target: 'pier', radius: 12, text: 'Meet Yara at the end of Pier Nine' },
      { type: 'kill', count: 4, text: 'Clear the Ferro crew off the pier' },
      { type: 'goto', target: 'club', radius: 10, text: 'Finish it at the Lantern Club' },
    ],
    onStart: (game) => {
      const pier = { x: game.world.city.landmarks.warehouse[0] + 28, z: -100 };
      game.marker = pier;
      game.player.giveAmmo('shotgun', 12);
      game.player.ammo.shotgun.mag = Math.max(game.player.ammo.shotgun.mag, 6);
      game.hud.toast('Breaker 12 in the trunk. Take it.', 'good');
      m_state(game, 'm6').pierX = pier.x;
      m_state(game, 'm6').pierZ = pier.z;
    },
    tick: (game, m) => {
      const lm = game.world.landmarks;
      const p = game.player;
      if (m.step === 0) {
        if (Math.hypot(p.x - m.pierX, p.z - m.pierZ) < 16) {
          m.step = 1;
          game.spawnGuardWave(m.pierX - 18, m.pierZ + 30, 4, 'ferro');
          game.hud.toast('They were waiting. Of course they were.', 'warn');
          game.police.crime('assault', 1.2);
        }
      } else if (m.step === 1) {
        game.marker = null;
        const alive = game.guards.filter((g) => !g.dead).length;
        if (!alive) {
          m.step = 2;
          game.marker = { x: lm.club[0], z: lm.club[1] + 4 };
          game.hud.toast('Nardo is at the club. Go.', 'warn');
        }
        if (p.dead) return game.failMission('The bay keeps its secrets.');
      } else if (m.step === 2) {
        if (Math.hypot(p.x - game.marker.x, p.z - game.marker.z) < 12) {
          game.spawnGuardWave(lm.club[0], lm.club[1] + 12, 3, 'ferro');
          m.step = 3;
          game.hud.toast('Nardo Ferro steps out of the light.', 'warn');
        }
        if (p.dead) return game.failMission('You never made the club.');
      } else if (m.step === 3) {
        const alive = game.guards.filter((g) => !g.dead).length;
        if (!alive) {
          game.player.money += 1600;
          game.completeMission();
        }
      }
    },
    outro: 'Nardo goes down in front of his own neon. Yara is already on the phone, moving money. "The bay has a new owner. It is not the Ferros. It is not the Trust."',
  },
  {
    id: 'm7', title: 'The Marina Heist', who: 'Dovie Marsh',
    kicker: 'Job 07 · The Yacht Basin',
    body: 'One yacht, one safe, one very expensive week. Dovie has the slip number and a man inside. The safe sits in the aft stateroom of the Cormorant II; the marina gate opens for a Cormorant. Take the boat, take the safe, and do not sink it.',
    unlock: ['m6'],
    reward: 2400, at: 'pier',
    steps: [
      { type: 'goto', target: 'pier', radius: 16, text: 'Get to the marina at Pier Nine' },
      { type: 'survive', seconds: 6, text: 'Crack the safe in the aft stateroom' },
      { type: 'escape', radius: 160, text: 'Get off the marina before the harbour patrol locks it down' },
    ],
    onStart: (game) => {
      game.marker = { x: game.world.city.landmarks.warehouse[0] + 26, z: -140 };
      m_state(game, 'm7').phase = 0;
      game.hud.toast('Marina · slip 41 · aft stateroom', 'info');
    },
    tick: (game, m) => {
      const pier = { x: game.world.city.landmarks.warehouse[0] + 26, z: -140 };
      const p = game.player;
      if (m.step === 0) {
        if (Math.hypot(p.x - pier.x, p.z - pier.z) < 20) {
          m.step = 1; m.timer = 0;
          game.police.crime('robbery', 1.8);
          game.hud.toast('The safe is ticking. Hold the deck.', 'warn');
          game.spawnGuardWave(pier.x + 4, pier.z + 14, 3, 'harbour');
        }
      } else if (m.step === 1) {
        m.timer += game.dt;
        if (m.timer > 7) {
          m.step = 2;
          game.player.money += 2400;
          game.audio.cash();
          game.hud.toast('Safe open · $2,400', 'good');
          game.marker = { x: pier.x + 150, z: pier.z + 60 };
        }
      } else {
        game.marker = { x: pier.x + 150, z: pier.z + 60 };
        if (Math.hypot(p.x - pier.x, p.z - pier.z) > 220 && game.police.level === 0) game.completeMission();
      }
    },
    outro: 'The marina light goes out behind you. Dovie is already spending it. "One more, baby. Then we are both clean."',
  },
  {
    id: 'm8', title: 'City Hall', who: 'Yara Pell',
    kicker: 'Job 08 · Cobalt Heights',
    body: 'One man in City Hall has been selling the bay to the Trust by the acre. Yara has his schedule and the floor plan of his panic room. Walk in, make him sign the deed back, and keep the mayor\'s security off you for long enough to hear the pen move.',
    unlock: ['m7'],
    reward: 3000, at: 'bank',
    steps: [
      { type: 'goto', target: 'bank', radius: 14, text: 'Enter City Hall on Cobalt Heights' },
      { type: 'kill', count: 5, text: 'Break through the mayor\'s security' },
      { type: 'survive', seconds: 5, text: 'Keep the pen on the deed' },
    ],
    onStart: (game) => {
      const lm = game.world.landmarks;
      game.marker = { x: lm.bank[0] - 22, z: lm.bank[1] + 18 };
      m_state(game, 'm8').wave = 0;
    },
    tick: (game, m) => {
      const lm = game.world.landmarks;
      const p = game.player;
      if (m.step === 0) {
        game.marker = { x: lm.bank[0] - 22, z: lm.bank[1] + 18 };
        if (Math.hypot(p.x - game.marker.x, p.z - game.marker.z) < 16) {
          m.step = 1;
          game.spawnGuardWave(lm.bank[0] - 18, lm.bank[1] + 22, 3, 'city');
          game.police.crime('trespass', 1.4);
          game.hud.toast('City Hall security. Trained, bored, armed.', 'warn');
        }
      } else if (m.step === 1) {
        game.marker = null;
        const alive = game.guards.filter((g) => !g.dead).length;
        if (!alive && m.timer === undefined) m.timer = -2;
        if (m.timer !== undefined) {
          m.timer += game.dt;
          if (alive > 0 && m.timer > 10) { m.timer = 0; game.spawnGuardWave(lm.bank[0] - 8, lm.bank[1] + 14, 2, 'city'); }
          if (m.timer > 6 && alive === 0) {
            m.step = 2; m.timer = 0;
            game.hud.toast('Deed signed. Everyone in this building saw it.', 'good');
          }
        }
        if (p.dead) return game.failMission('City Hall buries its problems.');
      } else {
        m.timer += game.dt;
        game.marker = null;
        if (m.timer > 5.5) {
          game.player.money += 3000;
          game.completeMission();
        }
      }
    },
    outro: 'The deed goes in Yara\'s bag. "Half the Trust board is going to wake up poor. The other half is going to wake up dead."',
  },
  {
    id: 'm9', title: 'Convoy', who: 'Dovie Marsh',
    kicker: 'Job 09 · The Causeway',
    body: 'The Trust moves its cash across the bay in two vans and a Warden escort, every third night, same route. Dovie wants the vans stopped and the escorts in the water. They will not stop for a polite honk.',
    unlock: ['m8'],
    reward: 4200, at: 'garage',
    steps: [
      { type: 'goto', target: 'garage', radius: 14, text: 'Take the Cormorant from the safehouse garage' },
      { type: 'kill', count: 2, text: 'Stop both cash vans' },
      { type: 'goto', target: 'garage', radius: 16, text: 'Run the cash back to the garage' },
    ],
    onStart: (game) => {
      const lm = game.world.landmarks;
      game.marker = { x: lm.garage[0], z: lm.garage[1] };
      m_state(game, 'm9').vans = [];
    },
    tick: (game, m) => {
      const lm = game.world.landmarks;
      const p = game.player;
      if (m.step === 0) {
        game.marker = { x: lm.garage[0], z: lm.garage[1] };
        if (Math.hypot(p.x - lm.garage[0], p.z - lm.garage[1]) < 18) {
          m.step = 1;
          const v1 = new Vehicle(game.world, vehicleSpec('pelican'), lm.garage[0] + 46, lm.garage[1] - 30, Math.PI / 2);
          const v2 = new Vehicle(game.world, vehicleSpec('pelican'), lm.garage[0] + 46, lm.garage[1] - 12, Math.PI / 2);
          for (const v of [v1, v2]) {
            v.color = [0.90, 0.86, 0.62];
            v.health = 160;
            v.missionVan = true;
            v.speed = 0;
            v.ai = { kind: 'escort', waypoints: [{ x: lm.garage[0] + 120, z: lm.garage[1] - 30 }, { x: lm.garage[0] + 190, z: lm.garage[1] - 60 }], speed: 13 };
            v.driver = 'ai';
            game.vehicles.push(v);
            game.guards.push({
              x: v.x, z: v.z, y: 0, yaw: 0, phase: 0, moving: 0, aim: true,
              fireTimer: 1, down: false, health: 80, guard: true, van: v,
              shirt: [0.24, 0.26, 0.30], pants: [0.12, 0.14, 0.18], skin: [0.72, 0.56, 0.42], hair: [0.10, 0.09, 0.08],
            });
            m.vans.push(v);
          }
          game.hud.toast('Two vans, one escort. Do not let them reach the bridge.', 'warn');
        }
      } else if (m.step === 1) {
        game.marker = m.vans[0] && !m.vans[0].dead ? { x: m.vans[0].x, z: m.vans[0].z } : { x: m.vans[1].x, z: m.vans[1].z };
        const down = m.vans.filter((v) => v.dead || v.health < 90).length;
        if (down >= 2) {
          m.step = 2;
          game.player.money += 4200;
          game.audio.cash();
          game.hud.toast('Vans down · $4,200 in the back seat', 'good');
          game.police.crime('armed robbery', 2.6);
          game.marker = { x: lm.garage[0], z: lm.garage[1] };
        }
      } else {
        game.marker = { x: lm.garage[0], z: lm.garage[1] };
        if (Math.hypot(p.x - lm.garage[0], p.z - lm.garage[1]) < 18) game.completeMission();
        if (p.dead) return game.failMission('The causeway took you.');
      }
    },
    outro: 'Dovie stacks the cash on the pool table in bricks. "That is the last of the Trust\'s walking-around money. Now they have to come see us."',
  },
  {
    id: 'm10', title: 'The Trust', who: 'Yara Pell',
    kicker: 'Job 10 · Cobalt Heights',
    body: 'The Trust board meets on the 40th floor with the doors locked and the police on the street. Yara wants the building, the board, and the safe under the table. Everything comes apart tonight: take the tower, clear the floor, and take the bay.',
    unlock: ['m9'],
    reward: 6500, at: 'bank',
    steps: [
      { type: 'goto', target: 'bank', radius: 16, text: 'Enter the Cobalt Trust tower' },
      { type: 'kill', count: 6, text: 'Clear the 40th floor' },
      { type: 'survive', seconds: 6, text: 'Open the Trust safe' },
    ],
    onStart: (game) => {
      const lm = game.world.landmarks;
      game.marker = { x: lm.bank[0] + 12, z: lm.bank[1] + 12 };
      game.police.crime('trespass', 2);
      game.player.giveAmmo('smg', 90);
      game.player.ammo.smg.mag = Math.max(game.player.ammo.smg.mag, 30);
      game.hud.toast('Sable SMG, full. They know you are coming.', 'good');
    },
    tick: (game, m) => {
      const lm = game.world.landmarks;
      const p = game.player;
      if (m.step === 0) {
        game.marker = { x: lm.bank[0] + 12, z: lm.bank[1] + 12 };
        if (Math.hypot(p.x - game.marker.x, p.z - game.marker.z) < 18) {
          m.step = 1;
          m.waves = 0;
          game.spawnGuardWave(lm.bank[0] + 10, lm.bank[1] + 16, 3, 'trust');
          game.police.crime('assault', 2);
        }
      } else if (m.step === 1) {
        game.marker = null;
        const alive = game.guards.filter((g) => !g.dead).length;
        m.timer = (m.timer ?? 0) + game.dt;
        if (alive === 0) {
          m.step = 2; m.timer = 0;
          game.hud.toast('Safe open. Six seconds of quiet.', 'good');
        } else if (m.timer > 12) {
          m.timer = 0;
          m.waves = (m.waves ?? 0) + 1;
          game.spawnGuardWave(lm.bank[0] + 6, lm.bank[1] + 20, 2, 'trust');
        }
        if (p.dead) return game.failMission('The 40th floor, and a window.');
      } else {
        m.timer += game.dt;
        game.marker = null;
        if (m.timer > 6.5) {
          game.player.money += 6500;
          game.completeMission();
        }
      }
    },
    outro: 'The tower lights go out floor by floor behind you. Yara is waiting by the car with the engine running. "Cobalt Bay. Six hundred thousand people. All of it yours if you can keep it."',
  },
  {
    id: 'm11', title: 'Salt Air', who: 'Dovie Marsh',
    kicker: 'Finale · The Freeway',
    body: 'The last of the Ferros got out of the bay with the ledger and a police escort. Dovie wants him back inside the county line. Chase him down the causeway, put him off the road, and come home. This is the last thing anybody asks of you.',
    unlock: ['m10'],
    reward: 12000, at: 'garage',
    steps: [
      { type: 'goto', target: 'garage', radius: 16, text: 'Take the Barracuda from the garage' },
      { type: 'chase', text: 'Run the Ferro car off the causeway' },
      { type: 'goto', target: 'garage', radius: 20, text: 'Come home to the garage' },
    ],
    onStart: (game) => {
      const lm = game.world.landmarks;
      game.marker = { x: lm.garage[0], z: lm.garage[1] };
      m_state(game, 'm11').ferro = null;
    },
    tick: (game, m) => {
      const lm = game.world.landmarks;
      const p = game.player;
      if (m.step === 0) {
        game.marker = { x: lm.garage[0], z: lm.garage[1] };
        if (Math.hypot(p.x - lm.garage[0], p.z - lm.garage[1]) < 20) {
          m.step = 1;
          const car = new Vehicle(game.world, vehicleSpec('barracuda'), lm.garage[0] + 70, lm.garage[1] - 40, Math.PI / 2);
          car.color = [0.62, 0.10, 0.12];
          car.health = 220;
          car.ai = { kind: 'flee' };
          car.driver = 'ai';
          car.missionCar = true;
          car.police = true;
          game.vehicles.push(car);
          m.ferro = car;
          game.police.crime('chase', 1.2);
          game.hud.toast('Red Barracuda. North on Cobalt Blvd. Go.', 'warn');
        }
      } else if (m.step === 1) {
        if (!m.ferro || m.ferro.dead || m.ferro.health < 40) {
          m.step = 2;
          m.ferro && (m.ferro.dead = true);
          game.hud.toast('Ferro is in the wall. Ledger is in the boot.', 'good');
          game.player.money += 12000;
          game.audio.cash();
          game.marker = { x: lm.garage[0], z: lm.garage[1] };
          return;
        }
        game.marker = { x: m.ferro.x, z: m.ferro.z };
        const d = Math.hypot(p.x - m.ferro.x, p.z - m.ferro.z);
        if (d > 260) return game.failMission('The Ferry slipped the county line.');
        if (p.dead) return game.failMission('You went into the barrier at a hundred.');
      } else {
        game.marker = { x: lm.garage[0], z: lm.garage[1] };
        if (Math.hypot(p.x - lm.garage[0], p.z - lm.garage[1]) < 24) {
          game.nextChapter();
        }
      }
    },
    outro: 'The garage door comes down on the last of it. Dovie puts two glasses on the pool table and pours something amber. Outside, the bay keeps humming, and every light on it pays you now.',
  },
];

function m_state(game, id) {
  const m = game.mission;
  if (m && m.mission.id === id) return m.state;
  return {};
}

export class MissionSystem {
  constructor(game) {
    this.game = game;
    this.index = 0;
    this.mission = null;
    this.state = {};
    this.failed = [];
    this.completed = [];
    this.card = null;
    this.cardTime = 0;
    this.cooldown = 0;
  }

  get active() { return this.mission; }

  start(index) {
    const game = this.game;
    const def = MISSIONS[index];
    if (!def) return;
    this.index = index;
    this.mission = def;
    this.state = {};
    this.stepIndex = 0;
    game.missionCardTime = 3.4;
    game.pushCard(def);
    game.audio.stinger();
    game.marker = null;
    if (def.onStart) def.onStart(game);
    game.hud.objective(def.steps[0].text, def.kicker.toUpperCase());
    game.audio.setMusic?.(true);
  }

  ensureStarted() {
    if (this.mission) return;
    if (this.completed.length >= MISSIONS.length) return;
    // start the next unlocked mission that isn't done
    for (let i = 0; i < MISSIONS.length; i++) {
      if (this.completed.includes(MISSIONS[i].id)) continue;
      const def = MISSIONS[i];
      const unlocked = !def.unlock || def.unlock.every((u) => this.completed.includes(u));
      if (unlocked) { this.start(i); return; }
    }
  }

  update(dt) {
    const game = this.game;
    if (!this.mission) {
      this.cooldown -= dt;
      if (this.cooldown <= 0) this.ensureStarted();
      return;
    }
    const m = this.mission;
    const step = m.steps[this.stepIndex];
    if (m.tick) m.tick(game, this, dt);
    // objective line follows the current step
    if (step) game.hud.objective(step.text, m.kicker.toUpperCase());
    if (game.marker && game.missionMarker !== game.marker) {
      game.missionMarker = game.marker;
    }
    if (!game.marker) game.missionMarker = null;
  }

  complete() {
    const game = this.game;
    const m = this.mission;
    if (!m) return;
    this.completed.push(m.id);
    game.player.money += m.reward;
    game.hud.toast(`${m.title} complete · $${m.reward.toLocaleString('en-US')}`, 'good');
    game.audio.success();
    game.pushCard({
      title: m.title,
      kicker: 'Mission complete',
      body: m.outro,
      who: m.who,
      complete: true,
    });
    game.missionCardTime = 4.2;
    setTimeout(() => {}, 0);
    this.mission = null;
    this.state = {};
    game.marker = null;
    game.missionMarker = null;
    game.guards.length = 0;
    game.bagsmen.length = 0;
    game.missionActor = null;
    this.cooldown = 2.2;
    game.onMissionDone(m);
  }

  fail(reason) {
    const game = this.game;
    if (!this.mission) return;
    const m = this.mission;
    game.hud.toast(`Failed · ${reason}`, 'warn', 4);
    game.audio.fail();
    game.missionCardTime = 3.0;
    game.pushCard({ title: 'Mission failed', kicker: m.title, body: reason, who: m.who, complete: true });
    this.mission = null;
    this.state = {};
    game.marker = null;
    game.missionMarker = null;
    game.guards.length = 0;
    game.bagsmen.length = 0;
    game.missionActor = null;
    this.cooldown = 3.0;
  }

  serialize() {
    return { completed: this.completed, index: this.index };
  }
  restore(s) {
    this.completed = s.completed ?? [];
    this.index = s.index ?? 0;
    this.mission = null;
    this.state = {};
  }
}
