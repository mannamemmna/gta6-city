// The story thread: three missions that chain off one another, each with objective markers, a
// mission title card, dialogue, a fail state (death or a car wreck) and a cash reward. Missions are
// plain data plus a small state machine, so a contact marker in the world is all the player needs to
// find to advance the story.
import * as THREE from 'three';
import { Humanoid } from './humanoid.js';

const mkMarker = (radius = 2.4, color = 0xffcf4a) => {
  const group = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius * 0.82, radius, 26),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.06;
  group.add(ring);
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.55, radius * 0.95, 40, 14, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false }),
  );
  beam.position.y = 20;
  group.add(beam);
  const diamond = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.42),
    new THREE.MeshBasicMaterial({ color }),
  );
  diamond.position.y = 2.6;
  group.add(diamond);
  return { group, ring, beam, diamond };
};

export const MISSIONS = [
  {
    id: 'collections',
    title: 'Bad Debts',
    kicker: 'MISSION 1',
    contact: 'Rafa',
    contactPlace: { x: -38, z: 26 },
    reward: 1200,
    intro: [
      ['RAFA', 'Marisol. You look like a woman with forty-eight hours and no plan.'],
      ['MARISOL', 'I have a plan. It starts with the money Tavo owes me.'],
      ['RAFA', 'Tavo\'s collectors work the strip. Take back what is yours — and while you are at it, take their car.'],
    ],
    steps: [
      { id: 'drive', text: 'Take the car outside and drive to the collection point.', kind: 'goto', at: { x: 132, z: 96 }, radius: 8 },
      { id: 'collect', text: 'Collect from the dealer. He will not hand it over politely.', kind: 'combat', at: { x: 132, z: 96 } },
      { id: 'escape', text: 'Lose the heat and get back to Rafa.', kind: 'return', at: { x: -38, z: 26 }, radius: 7 },
    ],
    enemies: [{ x: 128, z: 92 }, { x: 137, z: 98 }, { x: 132, z: 105 }],
  },
  {
    id: 'package',
    title: 'Salt and Ashes',
    kicker: 'MISSION 2',
    contact: 'Nela',
    contactPlace: { x: 62, z: -122 },
    reward: 2400,
    intro: [
      ['NELA', 'The harbour boys are moving something through the pier tonight.'],
      ['MARISOL', 'And I care because?'],
      ['NELA', 'Because half of it is Tavo\'s. Pick it up before the cops do and we both eat.'],
    ],
    steps: [
      { id: 'go', text: 'Drive to the pier on Playa Marea before the handoff ends.', kind: 'goto', at: { x: -26, z: 252 }, radius: 9, timer: 95 },
      { id: 'fight', text: 'The handoff is a trap. Take out the crew.', kind: 'combat', at: { x: -26, z: 252 } },
      { id: 'deliver', text: 'Deliver the case to Nela at the marina lot.', kind: 'goto', at: { x: 62, z: -122 }, radius: 8 },
    ],
    enemies: [{ x: -32, z: 246 }, { x: -20, z: 248 }, { x: -27, z: 258 }, { x: -18, z: 258 }],
  },
  {
    id: 'rooftop',
    title: 'Golden Hour',
    kicker: 'MISSION 3',
    contact: 'Rafa',
    contactPlace: { x: -38, z: 26 },
    reward: 6000,
    intro: [
      ['RAFA', 'Tavo is at the Mirador tower, top floor, counting money that should be yours.'],
      ['MARISOL', 'Then I will go up and help him count.'],
      ['RAFA', 'He has eight men and a police radio. Do it fast, do it loud, and do not come back without the ledger.'],
    ],
    steps: [
      { id: 'reach', text: 'Reach the Mirador tower forecourt in Centro.', kind: 'goto', at: { x: 0, z: -46 }, radius: 10 },
      { id: 'assault', text: 'Clear Tavo\'s crew in the forecourt.', kind: 'combat', at: { x: 0, z: -46 }, waves: 2 },
      { id: 'getaway', text: 'Escape with the ledger. Survive three stars and reach Rafa.', kind: 'return', at: { x: -38, z: 26 }, radius: 7, stars: 3 },
    ],
    enemies: [
      { x: -6, z: -50 }, { x: 6, z: -52 }, { x: -10, z: -40 }, { x: 10, z: -42 },
      { x: 0, z: -58 }, { x: -14, z: -58 }, { x: 14, z: -34 }, { x: 2, z: -34 },
    ],
  },
];

export class MissionSystem {
  constructor(city, scene, opts = {}) {
    this.city = city;
    this.scene = scene;
    this.index = 0;              // which mission is next
    this.active = null;
    this.step = 0;
    this.state = 'idle';         // idle | active | done
    this.marker = null;
    this.contactMarker = null;
    this.enemies = [];
    this.guards = [];
    this.timer = 0;
    this.starsAtStart = 0;
    this.combatKills = 0;
    this.wave = 0;
    this.hud = null;
    this.onBanner = null;
    this.onSay = null;
    this.onToast = null;
    this.onReward = null;
    this.player = null;
    this.police = null;
    this.combat = null;
    this.audio = null;
    this.contactMarkers = new Map();
    this.buildContactMarkers();
    this.showContact();
  }

  buildContactMarkers() {
    const seen = new Set();
    for (const m of MISSIONS) {
      const key = `${m.contactPlace.x},${m.contactPlace.z}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const marker = mkMarker(2.2, 0x7ce0a0);
      marker.group.position.set(m.contactPlace.x, 0, m.contactPlace.z);
      marker.group.visible = false;
      this.scene.add(marker.group);
      this.contactMarkers.set(key, marker);
    }
  }

  get contactKey() {
    const next = this.nextUp();
    return next ? `${next.contactPlace.x},${next.contactPlace.z}` : null;
  }

  nextUp() {
    return this.state === 'active' ? null : MISSIONS[this.index] ?? null;
  }

  showContact() {
    for (const [, marker] of this.contactMarkers) marker.group.visible = false;
    const key = this.contactKey;
    if (key && this.contactMarkers.has(key)) this.contactMarkers.get(key).group.visible = true;
  }

  markers() {
    const list = [];
    if (this.active && this.marker) {
      const step = this.active.steps[this.step];
      list.push({ x: step.at.x, z: step.at.z, color: step.kind === 'combat' ? '#ff5f5e' : '#ffcf4a' });
    }
    const key = this.contactKey;
    if (key) {
      const [x, z] = key.split(',').map(Number);
      list.push({ x, z, color: '#7ce0a0' });
    }
    return list;
  }

  /** What the HUD shows as the current objective. */
  objective() {
    if (this.active) {
      const step = this.active.steps[this.step];
      let text = step.text;
      if (step.timer && this.timer > 0) {
        text += `  (${Math.ceil(this.timer)}s)`;
      }
      if (this.active.enemies && this.stepIsCombat()) {
        const left = this.enemies.filter((e) => !e.dead).length;
        text += `  — ${left} hostiles left`;
      }
      return { title: this.active.title, text };
    }
    return { title: 'No mission', text: '' };
  }

  stepIsCombat() {
    return this.active?.steps[this.step]?.kind === 'combat';
  }

  start(index = this.index) {
    const mission = MISSIONS[index];
    if (!mission) return;
    this.index = index;
    this.active = mission;
    this.step = 0;
    this.state = 'active';
    this.combatKills = 0;
    this.wave = 0;
    this.timer = mission.steps[0].timer ?? 0;
    this.starsAtStart = this.police?.wanted ?? 0;
    this.hideContactMarkers();
    this.setStepMarker(0);
    this.onBanner?.(mission.kicker, mission.title);
    this.sayIntro(mission.intro);
    this.audio?.play('mission');
    if (mission.steps[0].kind === 'combat') this.spawnEnemies(mission.enemies ?? []);
  }

  hideContactMarkers() {
    for (const [, marker] of this.contactMarkers) marker.group.visible = false;
  }

  sayIntro(lines) {
    this.dialogueQueue = [...lines];
    this.nextLine();
  }

  nextLine() {
    if (!this.dialogueQueue || this.dialogueQueue.length === 0) {
      this.onSay?.(null, null);
      return;
    }
    const [who, text] = this.dialogueQueue.shift();
    this.onSay?.(who, text);
  }

  setStepMarker(index) {
    const step = this.active?.steps[index];
    if (this.marker) { this.scene.remove(this.marker.group); this.marker = null; }
    if (!step) return;
    const color = step.kind === 'combat' ? 0xff4b45 : 0xffcf4a;
    this.marker = mkMarker(step.kind === 'combat' ? 3.0 : 2.6, color);
    this.marker.group.position.set(step.at.x, 0, step.at.z);
    this.scene.add(this.marker.group);
  }

  spawnEnemies(list) {
    for (const e of list) {
      const rig = new Humanoid({
        skin: 0x8a5433, shirt: 0x2c2f36, pants: 0x3a3327, hair: 0x120e0c, vest: 0x4a3a2e,
        random: () => Math.random(), scale: 1.0,
      });
      rig.setPosition(e.x, 0, e.z);
      this.scene.add(rig.group);
      this.enemies.push({
        rig, x: e.x, z: e.z, heading: 0, hp: 70, dead: false,
        fireCooldown: 0.8 + Math.random(), deadT: 0, alert: false,
      });
    }
  }

  /** Advances the mission state machine. Called once a frame with the live game. */
  update(dt, game) {
    this.player = game.player;
    this.police = game.police;
    this.combat = game.combat;
    if (this.state !== 'active') {
      // contact marker: walk into it to start the next mission
      const next = this.nextUp();
      if (next) {
        const d = Math.hypot(game.player.x - next.contactPlace.x, game.player.z - next.contactPlace.z);
        if (d < 2.6 && !game.player.car) {
          this.start(this.index);
        }
      }
      this.animateMarkers(dt, game);
      return;
    }

    this.animateMarkers(dt, game);
    const step = this.active.steps[this.step];
    if (step.timer && this.timer > 0) {
      this.timer -= dt;
      if (this.timer <= 0) { this.fail('Out of time'); return; }
    }
    const px = game.player.car ? game.player.car.x : game.player.x;
    const pz = game.player.car ? game.player.car.z : game.player.z;
    const dist = Math.hypot(px - step.at.x, pz - step.at.z);

    if (step.kind === 'goto' && dist < (step.radius ?? 7)) {
      this.advance(game);
    } else if (step.kind === 'return' && dist < (step.radius ?? 7)) {
      if (step.stars && (this.police?.wanted ?? 0) < step.stars) this.advance(game);
      else if (!step.stars) this.advance(game);
    } else if (step.kind === 'combat') {
      this.updateEnemies(dt, game);
      const alive = this.enemies.filter((e) => !e.dead).length;
      if (this.enemies.length > 0 && alive === 0) {
        if (step.waves && this.wave + 1 < step.waves) {
          this.wave += 1;
          this.spawnEnemies(this.active.enemies ?? []);
          this.onToast?.('More of them coming');
        } else {
          this.advance(game);
        }
      }
    }
    // mission fail: player dead
    if (game.player.dead) this.fail('You were taken down');
  }

  advance(game) {
    this.step += 1;
    const mission = this.active;
    if (this.step >= mission.steps.length) { this.complete(); return; }
    const step = mission.steps[this.step];
    this.timer = step.timer ?? 0;
    this.setStepMarker(this.step);
    if (step.kind === 'combat') {
      this.spawnEnemies(mission.enemies ?? []);
      if (this.wave > 0) { /* already spawned */ }
    }
    this.onToast?.(this.objective().text);
    this.audio?.play('objective');
  }

  complete() {
    const mission = this.active;
    this.state = 'idle';
    this.active = null;
    this.index += 1;
    this.enemies.length = 0;
    if (this.marker) { this.scene.remove(this.marker.group); this.marker = null; }
    this.onBanner?.('MISSION COMPLETE', mission.title, 3.4);
    this.onReward?.(mission.reward);
    this.audio?.play('complete');
    if (this.index >= MISSIONS.length) {
      this.state = 'done';
      this.onBanner?.('STORY COMPLETE', 'Vela Costa is yours', 5);
    }
    this.showContact();
  }

  fail(reason) {
    if (this.state !== 'active') return;
    this.onBanner?.('MISSION FAILED', reason, 3.0);
    this.audio?.play('fail');
    this.state = 'idle';
    this.active = null;
    this.enemies.length = 0;
    if (this.marker) { this.scene.remove(this.marker.group); this.marker = null; }
    this.player.health = Math.max(28, this.player.health);
    this.player.dead = false;
    this.player.rig.rig.rotation.x = 0;
    this.police?.setWanted(0);
    this.showContact();
  }

  animateMarkers(dt, game) {
    const t = performance.now() / 1000;
    if (this.marker) {
      this.marker.ring.scale.setScalar(1 + Math.sin(t * 2.4) * 0.06);
      this.marker.diamond.position.y = 2.6 + Math.sin(t * 2.0) * 0.24;
      this.marker.diamond.rotation.y = t * 1.2;
    }
    for (const [, marker] of this.contactMarkers) {
      if (!marker.group.visible) continue;
      marker.ring.scale.setScalar(1 + Math.sin(t * 2.1) * 0.07);
      marker.diamond.position.y = 2.6 + Math.sin(t * 1.7) * 0.3;
      marker.diamond.rotation.y = t * 0.9;
    }
  }

  /** Enemy AI: hold a position near their spawn, turn to the player, shoot on a timer. */
  updateEnemies(dt, game) {
    const px = game.player.car ? game.player.car.x : game.player.x;
    const pz = game.player.car ? game.player.car.z : game.player.z;
    this.combat = game.combat;
    this.police = game.police;
    for (const e of this.enemies) {
      if (e.dead) { e.rig.update(dt, 0); e.deadT = (e.deadT ?? 0) + dt; continue; }
      const dx = px - e.x, dz = pz - e.z;
      const dist = Math.hypot(dx, dz);
      e.heading = Math.atan2(dx, dz);
      e.rig.setHeading(e.heading);
      // close the distance to ~12 m, then hold and shoot
      if (dist > 13) {
        const sp = 3.1;
        e.x += (dx / dist) * sp * dt;
        e.z += (dz / dist) * sp * dt;
      }
      e.rig.setPosition(e.x, 0, e.z);
      e.rig.update(dt, dist > 13 ? 3.1 : 0, { aiming: dist < 30 });
      e.fireCooldown -= dt;
      if (dist < 32 && e.fireCooldown <= 0) {
        e.fireCooldown = 1.15 + Math.random() * 0.9;
        const hit = Math.random() < 0.4;
        const from = { x: e.x, y: 1.35, z: e.z };
        const to = { x: px + (hit ? 0 : (Math.random() - 0.5) * 1.6), y: 1.1, z: pz + (hit ? 0 : (Math.random() - 0.5) * 1.6) };
        game.combat.trace(from, to);
        if (hit) game.player.hurt(8);
        game.audio?.play('enemyShot', Math.max(0.05, 1 - dist / 40));
        game.combat.policeSystem = game.police; // keep bindings alive
      }
    }
    // the player's bullets kill enemies too: checked by the game loop
  }

  /** Called when the player's shot tests against mission enemies. */
  hitEnemy(origin, dir, maxDist) {
    let best = null;
    let bestT = maxDist;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const ox = origin.x - e.x, oy = origin.y - 1.05, oz = origin.z - e.z;
      const b = ox * dir.x + oy * dir.y + oz * dir.z;
      const c = ox * ox + oy * oy + oz * oz - 0.55 * 0.55;
      const disc = b * b - c;
      if (disc < 0) continue;
      const sq = Math.sqrt(disc);
      const t0 = -b - sq;
      if (t0 > 0.1 && t0 < bestT) { bestT = t0; best = e; }
    }
    return best ? { enemy: best, t: bestT } : null;
  }

  killEnemy(e) {
    if (e.dead) return;
    e.dead = true;
    e.deadT = 0;
    e.rig.die();
    this.combatKills += 1;
  }
}

export { mkMarker };
