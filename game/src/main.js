// Cobalt Bay: the game shell. Builds the world, owns the loop, routes input to the
// player or the car, runs the systems in order and draws the frame. Also handles
// ?shot= staging so a screenshot always shows a finished, deterministic scene.

import { CITY, CLOCK, MONEY, PLAYER, SKY, SUN, WEAPONS } from './config.js';
import { createRenderer } from './renderer.js';
import { SceneBuffers } from './instances.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Camera } from './camera.js';
import { Input } from './input.js';
import { Hud } from './hud.js';
import { Audio } from './audio.js';
import { Combat } from './combat.js';
import { Police } from './police.js';
import { Traffic } from './traffic.js';
import { Vehicle, spawnTraffic, spawnParked, vehicleSpec } from './vehicles.js';
import { Pedestrian, spawnCrowd } from './pedestrians.js';
import { Guard, Bagman } from './actors.js';
import { MissionSystem, MISSIONS } from './missions.js';
import { Menus } from './menus.js';
import { saveGame, loadGame, hasSave } from './save.js';
import { clamp, damp, lerp } from './math3d.js';
import { makeRng } from './rng.js';
import { drawPerson } from './models.js';

const MAT = { LIT: 0, GLOW: 1 };

export class Game {
  constructor() {
    this.canvas = document.getElementById('gl');
    this.hudCanvas = document.getElementById('hud');
    this.renderer = createRenderer(this.canvas);
    this.buffers = new SceneBuffers(9000);
    this.input = new Input(this.canvas);
    this.audio = new Audio();
    this.hud = new Hud(this.hudCanvas);
    this.cam = new Camera();
    this.menus = new Menus(this);
    this.menus.bind();
    this.state = 'loading';
    this.time = 0;
    this.dt = 0;
    this.frame = 0;
    this.paused = false;
    this.running = false;
    this.missionCardTime = 0;
    this.alarmLevel = 0;
    this.marker = null;
    this.missionMarker = null;
    this.missionActor = null;
    this.missionKills = 0;
    this.stats = { carsStolen: 0, peds: 0, shots: 0, distance: 0 };
    this.rep = 0;
    this.property = {};
    this.visitedDistricts = new Set();
    this.guards = [];
    this.bagsmen = [];
    this.pendingExplosions = [];
    this.buildQueued = false;
    this.shot = new URLSearchParams(location.search).get('shot');
    this.seed = parseInt(new URLSearchParams(location.search).get('seed') ?? '20261117', 10) || 20261117;
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.input.onUnlock = () => {
      if (this.state === 'playing' && !this.isShot) this.pause();
    };
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.renderer.setSize(w, h, dpr);
    this.hud.setSize(w, h, dpr);
    this.w = w; this.h = h;
  }

  // ---------------------------------------------------------------- lifecycle

  async boot() {
    this.buildWorld();
    this.buildActors();
    this.menus.ready();
    this.state = 'title';
    if (this.shot) {
      this.isShot = true;
      this.menus.hideAll();
      await stageShot(this, this.shot);
      this.state = 'playing';
      return; // the staged frame is final; no live loop for a capture
    }
    this.startLoop();
  }

  buildWorld() {
    this.world = new World(this.seed);
    this.renderer.uploadStatic(this.staticBatches());
    this.player = new Player(this.world);
    this.combat = new Combat(this.world, this);
    this.police = new Police(this.world, this);
    this.missions = new MissionSystem(this);
  }

  staticBatches() {
    const city = this.world.city.batches;
    const extra = {
      geometry: 'box',
      data: new Float32Array(11 * 6),
      count: 0,
    };
    // sea, one huge flat box just under the island
    const sea = [];
    const pushSea = (x, z, w, d) => {
      sea.push(x, -1.4, z, w, 1.4, d, 0, 0.10, 0.40, 0.46, MAT.WATER);
    };
    pushSea(0, 0, 4200, 4200);
    const seaBatch = { geometry: 'box', data: new Float32Array(sea), count: sea.length / 11 };
    // island skirts: the beach and dock edges shouldn't float
    const skirts = [];
    const lh = this.world.city.landHalf;
    const skirt = (x, z, w, d) => skirts.push(x, -3.2, z, w, 3.2, d, 0, 0.56, 0.52, 0.44, MAT.LIT);
    skirt(0, 0, lh * 2, lh * 2);
    return [...city, seaBatch, { geometry: 'box', data: new Float32Array(skirts), count: skirts.length / 11 }];
  }

  buildActors() {
    const rng = makeRng(this.seed ^ 0x1234);
    this.rng = rng;
    this.vehicles = spawnTraffic(this.world, 26, rng);
    this.vehicles.push(...spawnParked(this.world, rng));
    this.peds = spawnCrowd(this.world, rng);
    this.traffic = new Traffic(this.world, this.vehicles, rng);
  }

  startLoop() {
    let last = performance.now();
    const step = (now) => {
      const dtRaw = (now - last) / 1000;
      last = now;
      const dt = clamp(dtRaw || 0.016, 0.001, 0.05);
      this.tick(dt);
      this.paint();
    };
    const loop = (now) => {
      step(now);
      if (this.running || this.isShot) this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
    // Headless Chrome may throttle rAF; a timer keeps the picture alive.
    this.timerId = setInterval(() => {
      if (document.hidden || this.forceTimer) {
        step(performance.now());
        this.paint();
      }
    }, 1000 / 30);
    if (this.isShot) this.forceTimer = true;
  }

  async startNewGame() {
    this.audio.start();
    this.player.spawn(0, 0, 0);
    const g = this.world.landmarks.garage;
    this.player.spawn(g[0] + 4, g[1] + 6, Math.PI);
    this.player.money = MONEY.start;
    this.state = 'playing';
    this.running = true;
    this.paused = false;
    this.menus.hideAll();
    this.cam.reset();
    this.input.canRequestLock = true;
    this.missions.completed = [];
    this.missions.mission = null;
    this.missions.cooldown = 1.2;
    this.police.clear();
    this.hud.toast('Cobalt Bay · the marina is east', 'info', 4);
    this.hud.showHint('WASD to move · F to get in a car · click to look', 5);
    this.audio.attachEngine();
    this.audio.attachSiren();
    this.input.lock();
  }

  toTitle() {
    this.running = false;
    this.state = 'title';
    this.paused = false;
    this.menus.show('title');
    this.hud.visible = false;
    if (hasSave()) document.getElementById('btn-continue')?.classList.remove('hidden');
  }

  pause() {
    if (this.state !== 'playing') return;
    this.paused = true;
    this.state = 'pause';
    this.input.unlock();
    this.menus.pause();
    this.audio.engineOff();
  }

  resume() {
    this.paused = false;
    this.state = 'playing';
    this.menus.hideAll();
    this.input.lock();
  }

  saveGame() {
    const ok = saveGame(this);
    this.hud.toast(ok ? 'Game saved' : 'Save failed', ok ? 'good' : 'warn');
  }

  loadGame() {
    const ok = loadGame(this);
    if (!ok) { this.startNewGame(); return; }
    this.state = 'playing';
    this.running = true;
    this.paused = false;
    this.menus.hideAll();
    this.cam.reset();
    this.hud.toast('Welcome back to Cobalt Bay', 'good');
    this.audio.attachEngine();
    this.audio.attachSiren();
    this.input.lock();
  }

  // ------------------------------------------------------------------- update

  tick(dt) {
    if (this.state !== 'playing') {
      this.menus.update(dt);
      this.hud.update(dt);
      return;
    }
    this.time += dt;
    this.dt = dt;
    this.frame++;
    this.missionCardTime = Math.max(0, this.missionCardTime - dt);
    this.alarmLevel = Math.max(0, this.alarmLevel - dt * 0.35);

    const inp = this.input;
    const p = this.player;

    // camera yaw from the mouse, or from the car's heading when driving
    if (inp.locked || this.isShot) this.cam.look(inp.mouseDX, inp.mouseDY, PLAYER.aimSensitivity);
    if (p.vehicle) {
      // ease the camera behind the car unless the player is looking around
      if (Math.abs(inp.mouseDX) < 0.5) {
        const want = p.vehicle.yaw;
        let d = want - this.cam.yaw;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        this.cam.yaw += d * Math.min(1, dt * 1.9);
        this.cam.pitch = damp(this.cam.pitch, -0.10, 2.4, dt);
      }
    }

    p.update(dt, inp, this.cam, this);

    // driving
    if (p.vehicle) {
      const v = p.vehicle;
      const ax = inp.axis();
      const throttle = (!v.dead && (inp.down('KeyW') || inp.down('ArrowUp')) ? 1 : 0) -
        (inp.down('KeyS') || inp.down('ArrowDown') ? 1 : 0);
      const steer = (inp.down('KeyD') || inp.down('ArrowRight') ? 1 : 0) -
        (inp.down('KeyA') || inp.down('ArrowLeft') ? 1 : 0);
      v.update(dt, {
        throttle: throttle > 0 ? 1 : 0,
        brake: throttle < 0,
        steer,
        handbrake: inp.down('ShiftLeft'),
      }, this.world);
      this.audio.engine(clamp(Math.abs(v.forwardSpeed) / v.spec.top, 0, 1), throttle > 0 ? 1 : 0);
      p.x = v.x; p.z = v.z; p.y = v.y;
      this.stats.distance += v.speed * dt;
      if (v.dead) this.exitVehicle(true);
      if (inp.hit('KeyF')) this.exitVehicle();
      if (v.speed > v.spec.top * 0.72 && this.police.level === 0 && this.frame % 30 === 0) {
        this.police.crime('speeding', 0.18);
      }
      // run over pedestrians
      for (const ped of this.peds) {
        if (ped.dead) continue;
        const d = Math.hypot(ped.x - v.x, ped.z - v.z);
        if (d < v.spec.len * 0.42 && v.speed > 5) {
          ped.hurt(200, { x: v.x, z: v.z }, this.world);
          this.police.crime('pedestrian down', 0.7);
          this.audio.impact();
        }
      }
    } else {
      this.audio.engineOff();
      if (inp.hit('KeyF')) this.tryEnterVehicle();
    }

    // world and systems
    this.world.update(dt);
    this.traffic.update(dt, this);
    for (const ped of this.peds) ped.update(dt, this);
    for (const g of this.guards) g.update(dt, this);
    for (const b of this.bagsmen) b.update(dt, this);
    this.police.update(dt, this);
    this.combat.update(dt, inp, this.cam);
    if (!this.isShot) this.missions.update(dt);
    this.menus.update(dt);
    this.hud.update(dt);
    this.audio.siren(this.police.level);
    this.trackDistrict();
    this.shotTick?.(this);

    // camera target
    const subject = p.vehicle
      ? { x: p.vehicle.x, y: p.vehicle.y + 0.4, z: p.vehicle.z }
      : { x: p.x, y: p.y, z: p.z };
    if (!this.cam.frozen) {
      this.cam.update(dt, subject, this.world, {
        aiming: p.aiming && !p.vehicle,
        vehicle: p.vehicle,
        speed: p.vehicle ? p.vehicle.speed : 0,
        drift: p.vehicle ? p.vehicle.driftAmount : 0,
      });
    }

    // threat marker decay
    if (this.hintCooldown > 0) this.hintCooldown -= dt;

    // death handling
    if (p.dead && !this.deathHandled) {
      this.deathHandled = true;
      setTimeout(() => {
        if (this.state !== 'playing') return;
        this.paused = true;
        this.state = 'dead';
        this.input.unlock();
        this.menus.wasted(false);
      }, 1100);
    }

    inp.endFrame();
  }

  trackDistrict() {
    const name = this.districtName(this.player.x, this.player.z);
    if (!this.visitedDistricts.has(name)) {
      this.visitedDistricts.add(name);
      this.hud.toast(name, 'info', 2.4);
    }
  }

  districtName(x, z) {
    const half = CITY.half;
    if (z > this.world.city.beachZ) return 'Solana Beach';
    if (x > half - 40 && z < -half + 100) return 'Pier Nine';
    if (x < -half + 60 && z < -half + 130) return 'Ferro Yards';
    if (Math.abs(x) < 130 && Math.abs(z) < 150) return 'Cobalt Heights';
    return 'Lantern Row';
  }

  // -------------------------------------------------------------- car access

  nearestVehicle(x = this.player.x, z = this.player.z, maxDist = 6) {
    let best = null, bestD = maxDist;
    for (const v of this.vehicles) {
      if (v.dead || v.parked === false && v.driver === 'ai' && v.ai?.kind === 'chase') continue;
      const d = Math.hypot(v.x - x, v.z - z);
      if (d < bestD) { bestD = d; best = v; }
    }
    return best;
  }

  tryEnterVehicle() {
    const p = this.player;
    const car = this.nearestVehicle(p.x, p.z, 5.0);
    if (!car) {
      this.hud.showHint('No car close enough', 1.4);
      return;
    }
    if (car.ai && car.ai.kind === 'chase') {
      this.hud.showHint('Not that one', 1.4);
      return;
    }
    this.enterVehicle(car);
  }

  enterVehicle(car, silent = false) {
    const p = this.player;
    p.vehicle = car;
    car.driver = 'player';
    car.parked = false;
    const wasOwned = car.missionCar || car.spec.police;
    if (!wasOwned && !car.wasStolen) {
      car.wasStolen = true;
      this.stats.carsStolen++;
      this.police.crime('grand theft auto', 0.85);
    }
    if (!silent) {
      this.hud.showHint(`F to get out · ${car.spec.name}`, 2.2);
      this.audio.doorOpen();
      this.audio.start();
      this.audio.attachEngine();
    }
    p.x = car.x; p.z = car.z;
  }

  exitVehicle(forced = false) {
    const p = this.player;
    const car = p.vehicle;
    if (!car) return;
    car.driver = null;
    p.vehicle = null;
    // step out on the driver's side
    const side = 1.9;
    const ox = -Math.cos(car.yaw) * side;
    const oz = Math.sin(car.yaw) * side;
    let nx = car.x + ox, nz = car.z + oz;
    const [rx, rz] = this.world.colliders.resolve(nx, nz, p.radius);
    p.x = rx; p.z = rz;
    p.y = this.world.groundAt(p.x, p.z);
    p.vx = 0; p.vz = 0;
    p.moving = 0;
    this.audio.engineOff();
    if (!forced) this.audio.doorOpen();
    this.cam.yaw = car.yaw;
  }

  // ---------------------------------------------------------------- callbacks

  pushCard(card) { this.menus.pushCard(card); }

  completeMission() { this.missions.complete(); }
  failMission(reason) { this.missions.fail(reason); }

  onMissionDone(m) {
    this.rep += 1;
    const g = this.world.landmarks.garage;
    if (!this.property.garage) {
      this.property.garage = true;
      this.hud.toast('Safehouse garage unlocked · free repairs', 'good', 4);
    }
  }

  nextChapter() {
    this.completeMission();
    setTimeout(() => {
      this.pushCard({
        title: 'The bay is yours',
        kicker: 'Story complete',
        body: 'Eleven jobs, one city, no more bosses. Keep driving: the streets still pay, the police still come, and the marina still looks better from a stolen car.',
        who: 'Cobalt Bay',
        complete: true,
      });
    }, 300);
  }

  onPedKilled(ped) {
    this.stats.peds++;
    if (Math.random() < 0.4) {
      this.world.addFloater(ped.x, ped.y + 1.2, ped.z, '+$12', [0.7, 1, 0.6]);
      this.player.money += 12;
    }
  }

  onVehicleDestroyed(v) {
    this.world.addSpark(v.x, v.y + 1.2, v.z, 30, [1, 0.6, 0.2]);
    this.audio.explosion();
    const d = Math.hypot(v.x - this.cam.pos[0], v.z - this.cam.pos[2]);
    this.cam.shake = Math.min(0.5, this.cam.shake + clamp(1 - d / 40, 0, 1) * 0.5);
    this.combat.explosion(v.x, v.z, 8);
  }

  onRam(a, b) {
    this.audio.impact();
    this.cam.shake = Math.min(0.3, this.cam.shake + 0.16);
    a.health -= 4;
    b.health -= 6;
    if (b.health <= 0) b.explode(this.world);
  }

  onBusted() {
    if (this.state !== 'playing') return;
    this.state = 'dead';
    this.paused = true;
    this.input.unlock();
    this.player.money = Math.max(0, this.player.money - 250);
    this.police.clear();
    this.menus.wasted(true);
  }

  respawn() {
    const p = this.player;
    this.state = 'playing';
    this.paused = false;
    this.deathHandled = false;
    this.police.clear();
    if (p.vehicle) { p.vehicle.driver = null; p.vehicle = null; }
    const g = this.world.landmarks.garage;
    p.spawn(g[0] + 2, g[1] + 8, Math.PI);
    p.health = 100;
    p.armor = 0;
    p.dead = false;
    p.money = Math.max(0, p.money - (this.property.garage ? 0 : MONEY.hospitalBill));
    p.ammo.pistol.mag = Math.max(p.ammo.pistol.mag, 8);
    this.menus.hideAll();
    this.cam.reset();
    this.hud.toast(this.property.garage ? 'Patched up at the garage' : 'Billed by the hospital', 'info');
    this.input.lock();
  }

  spawnGuardWave(x, z, n, kind = 'ferro') {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random();
      const g = new Guard(this.world, x + Math.cos(a) * (5 + Math.random() * 6), z + Math.sin(a) * (5 + Math.random() * 6), kind);
      this.guards.push(g);
    }
  }

  spawnBagsmen(x, z, n) {
    for (let i = 0; i < n; i++) {
      this.bagsmen.push(new Bagman(this.world, x + (i - 1) * 2.4, z + Math.random() * 4));
    }
  }

  // ------------------------------------------------------------------ render

  paint() {
    const env = this.envForFrame();
    this.renderer.begin({ cam: { pos: this.cam.pos, target: this.cam.target, fov: this.cam.fov }, time: this.time, ...env });
    this.renderer.drawStatic();

    const buf = this.buffers;
    buf.reset();
    const p = this.player;
    const night = this.nightFactor();

    // vehicles
    for (const v of this.vehicles) {
      if (v.dead) continue;
      const d = Math.hypot(v.x - this.cam.pos[0], v.z - this.cam.pos[2]);
      if (d > 340) continue;
      v.draw(buf, { lightsOn: night > 0.35 || v.spec.police });
    }
    // pedestrians
    for (const ped of this.peds) {
      const d = Math.hypot(ped.x - this.cam.pos[0], ped.z - this.cam.pos[2]);
      if (d > 190) continue;
      ped.draw(buf);
    }
    // guards, bagmen, cops
    for (const g of this.guards) g.draw(buf);
    for (const b of this.bagsmen) b.draw(buf);
    this.police.draw(buf);
    if (!p.vehicle) p.draw(buf);

    // mission marker: a slow ring of light on the pavement
    const mk = this.missionMarker;
    if (mk) {
      const g = this.world.groundAt(mk.x, mk.z);
      const pulse = 0.65 + 0.35 * Math.sin(this.time * 2.6);
      buf.push(mk.x, g + 0.05, mk.z, 5.2, 0.05, 5.2, 0, [1.0 * pulse, 0.72 * pulse, 0.24 * pulse], MAT.GLOW);
      buf.push(mk.x, g + 0.9, mk.z, 0.34, 3.2, 0.34, 0, [1.0, 0.78, 0.30], MAT.GLOW);
      buf.push(mk.x, g + 3.4, mk.z, 0.9, 0.9, 0.9, 0, [1.0, 0.85, 0.40], MAT.GLOW);
    }

    // effects: decals, tracers, sparks, muzzle
    for (const d of this.world.decals) {
      const a = clamp(d.life / d.max, 0, 1);
      buf.push(d.x, this.world.groundAt(d.x, d.z) + 0.03, d.z, d.r * 2, 0.02, d.r * 2, 0,
        [d.color[0] * a, d.color[1] * a, d.color[2] * a], 4);
    }
    for (const t of this.world.tracers) {
      for (const f of [0.35, 0.55, 0.75, 0.92]) {
        buf.push(lerp(t.a[0], t.b[0], f), lerp(t.a[1], t.b[1], f), lerp(t.a[2], t.b[2], f),
          0.09, 0.09, 0.09, 0, t.color, MAT.GLOW);
      }
    }
    for (const s of this.world.sparks) {
      const a = clamp(s.life / 0.4, 0, 1);
      buf.push(s.x, s.y, s.z, 0.14 * a, 0.14 * a, 0.14 * a, 0,
        [s.color[0] * a, s.color[1] * a, s.color[2] * a], MAT.GLOW);
    }
    if (this.combat.muzzle) {
      const m = this.combat.muzzle;
      this.combat.muzzle = null;
      buf.push(m.x - Math.sin(this.cam.yaw) * 0.9, m.y + 0.1, m.z - Math.cos(this.cam.yaw) * 0.9,
        0.5, 0.5, 0.5, 0, [1, 0.9, 0.6], MAT.GLOW);
    }

    this.renderer.drawDynamic(buf.groups());
    this.hud.visible = this.state === 'playing' || this.isShot;

    // night ambience: street lamps get brighter discs at dusk
    if (night > 0.25) {
      // (handled by emissive materials; nothing extra to draw)
    }

    this.hud.draw(this);
  }

  nightFactor() {
    const h = this.world.clock;
    const t = Math.cos(((h - 13) / 24) * Math.PI * 2);
    return clamp(0.5 - t * 0.5, 0, 1);
  }

  envForFrame() {
    const h = this.world.clock;
    const dusk = Math.exp(-Math.pow((h - 18.2) / 2.2, 2));
    const dawn = Math.exp(-Math.pow((h - 6.2) / 1.8, 2));
    const night = this.nightFactor();
    const warm = Math.max(dusk, dawn * 0.8);
    const horizon = [
      lerp(SKY.horizon[0], 0.62, night * 0.75),
      lerp(SKY.horizon[1], 0.66, night * 0.7),
      lerp(SKY.horizon[2], 0.80, night * 0.45),
    ];
    const top = [
      lerp(SKY.top[0], 0.04, night * 0.85),
      lerp(SKY.top[1], 0.07, night * 0.8),
      lerp(SKY.top[2], 0.16, night * 0.7),
    ];
    const haze = [
      lerp(SKY.haze[0], 0.20, night * 0.7),
      lerp(SKY.haze[1], 0.22, night * 0.65),
      lerp(SKY.haze[2], 0.28, night * 0.55),
    ];
    const sunColor = [
      SUN.color[0],
      lerp(SUN.color[1], 0.72, warm * 0.6),
      lerp(SUN.color[2], 0.52, warm * 0.75),
    ];
    const fogEnd = this.fogOverride ?? SKY.fogEnd;
    // a staged wide shot can drop the sun toward the water so the bay carries a
    // glitter path instead of reading as a flat dark sheet
    let sunDir = SUN.dir;
    if (this.sunOverride) {
      const a = this.sunOverride.az, e = this.sunOverride.el;
      sunDir = [Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)];
    }
    return { horizon, top, haze, sunColor, night, fogEnd, sunDir };
  }
}

// ------------------------------------------------------------------ shot mode

async function stageShot(game, name) {
  game.hud.visible = true;
  game.state = 'playing';
  game.running = true;
  game.deathHandled = true;

  // A shot is a fixed composition: throw away the procedural traffic and crowd
  // so nothing spawns on top of a staged car or in front of the lens.
  game.vehicles.length = 0;
  game.peds.length = 0;

  const lm = game.world.landmarks;
  const s = name.toLowerCase();

  if (s === 'cover') {
    setupCoverShot(game);
  } else if (s === 'driving') {
    setupDrivingShot(game);
  } else if (s === 'mission') {
    setupMissionShot(game);
  } else if (s === 'vista') {
    setupVistaShot(game);
  } else {
    setupVistaShot(game);
  }

  // settle the scene: simulate without painting (software rasterisers are too
  // slow to paint every step), then paint the final frame and freeze the loop
  for (let i = 0; i < 90; i++) game.tick(1 / 60);
  game.cam.snap = true;
  game.tick(1 / 60);
  game.paint();
  await new Promise((r) => setTimeout(r, 80));
  game.paint();
  game.running = false;
  if (game.rafId) cancelAnimationFrame(game.rafId);
  if (game.timerId) clearInterval(game.timerId);
  window.__shotReady = true;
  window.__shotError = null;
}

function placePedAt(game, x, z, yaw, palette = {}) {
  const peds = game.peds;
  for (const ped of peds) {
    if (Math.hypot(ped.x - x, ped.z - z) < 4) {
      ped.x = x + 8; ped.z = z + 8;
    }
  }
  const ped = new Pedestrian(game.world, Math.random, x, z, null);
  Object.assign(ped, palette);
  ped.yaw = yaw;
  ped.target = { x, z };
  peds.push(ped);
  return ped;
}

const ROAD = (i) => -CITY.half + i * CITY.pitch;

function setupCoverShot(game) {
  game.cam.frozen = true;
  // three stars, a low chase camera on the boulevard, two cruisers in frame
  const x = ROAD(3), z = 62;
  const player = game.player;
  const car = new Vehicle(game.world, vehicleSpec('cormorant'), x, z, Math.PI);
  car.color = [0.66, 0.14, 0.12];
  game.vehicles.push(car);
  game.enterVehicle(car, true);
  player.vehicle = car;
  car.vx = 0; car.vz = -14;

  game.police.level = 3;
  game.police.meter = 0.45;

  // cruisers ahead-left and ahead-right, slewed across the lane, so the camera
  // behind the hero car sees them both in the middle distance
  const copSpots = [[-5.4, -13, 0.30, 0.9], [5.0, -19, -0.22, 3.6]];
  for (const [ox, oz, yaw, beat] of copSpots) {
    const cop = new Vehicle(game.world, vehicleSpec('warden'), x + ox, z + oz, yaw);
    cop.ai = { kind: 'chase', shirt: [0.10, 0.14, 0.24] };
    cop.driver = 'ai';
    cop.braking = true;
    game.vehicles.push(cop);
    game.police.units.push({ car: cop, dismounted: false, officer: null, beat });
  }
  game.police.officers.push(makeOfficer(game, x + 7.4, z - 15.0, 0.1));
  game.police.officers.push(makeOfficer(game, x - 7.0, z - 19.0, -0.2));

  // traffic parked along the kerbs so the street reads as a city
  const parked = [
    ['petrel', x - 6.6, z + 6, 0],
    ['tern', x + 6.6, z + 12, 0],
    ['pelican', x - 6.6, z - 52, 0],
    ['marisol', x + 6.6, z - 62, 0],
  ];
  for (const [id, px, pz, yaw] of parked) {
    const t = new Vehicle(game.world, vehicleSpec(id), px, pz, yaw);
    t.parked = true;
    game.vehicles.push(t);
  }
  for (let i = 0; i < 10; i++) {
    const side = i % 2 ? 1 : -1;
    placePedAt(game, x + side * (8.6 + (i % 3) * 0.9), z - 10 - i * 4.0, 0.4 * side, {
      shirt: [[0.85, 0.72, 0.55], [0.30, 0.36, 0.44], [0.68, 0.30, 0.26], [0.35, 0.54, 0.46]][i % 4],
    });
  }

  game.cam.yaw = Math.PI;
  game.cam.pitch = -0.10;
  game.cam.pos = [x + 1.1, 4.05, z + 9.4];
  game.cam.target = [x + 0.9, 1.35, z - 26];
  game.cam.fov = 1.12;
  game.cam.snap = false;
  game.hud.objective('Escape the pursuit — 3 stars', 'WANTED');
  game.hud.toast('Cobalt Bay PD is on you', 'warn', 99);
  game.missionMarker = null;
  game.shotTick = (g) => {
    // pin the hero car and the cruisers: the shot is a composition, not a physics test
    g.police.units.forEach((u, i) => {
      const [ox, oz, yaw, beat] = copSpots[i] ?? copSpots[0];
      u.car.x = x + ox; u.car.z = z + oz; u.car.yaw = yaw;
      u.car.vx = 0; u.car.vz = 0; u.car.speed = 0; u.car.braking = true;
      u.car.siren = beat;
    });
    const v = g.player.vehicle;
    v.x = x; v.z = z; v.yaw = Math.PI;
    v.vx = 0; v.vz = -13; v.steer = 0.10; v.driftAmount = 0.35;
    g.player.x = v.x; g.player.z = v.z;
    g.cam.pos = [x + 1.1, 4.05, z + 9.4];
    g.cam.target = [x + 0.9, 1.35, z - 26];
    g.cam.yaw = Math.PI; g.cam.pitch = -0.12; g.cam.fov = 1.12;
  };
}

function makeOfficer(game, x, z, yaw) {
  return {
    x, z, y: game.world.groundAt(x, z), yaw, phase: 0, moving: 0, aim: true,
    fireTimer: 99, down: false, timer: 0, health: 90,
    shirt: [0.16, 0.20, 0.32], pants: [0.10, 0.12, 0.18],
    skin: [0.82, 0.66, 0.50], hair: [0.10, 0.09, 0.08], hat: [0.10, 0.13, 0.22],
  };
}

function setupDrivingShot(game) {
  game.cam.frozen = true;
  // street-level driving beat: a dusk run down the beach boulevard, hero car in
  // the near lane, traffic streaming both ways, palms and the sun sitting on the
  // water where the avenue ends.
  const x = ROAD(4), z = 158;
  const lane = x + 3.3;       // northbound lane (forward is +z at yaw 0)
  const oncoming = x - 3.3;   // southbound, facing the lens

  const car = new Vehicle(game.world, vehicleSpec('skua'), lane, z, 0);
  car.color = [0.13, 0.50, 0.44];
  game.vehicles.push(car);
  game.enterVehicle(car, true);
  game.player.vehicle = car;
  car.vx = 0; car.vz = 33;

  // the sky: far enough into dusk that lamps and taillights read, sun on the
  // water dead ahead so the avenue runs into the glare
  game.world.clock = 18.5;
  game.sunOverride = { az: 0.05, el: 0.075 };
  game.fogOverride = 700;

  // our lane, spaced out so the hero car has a clear run at the junction
  const ahead = [
    ['petrel', 34, -0.5], ['tern', 58, 0.4], ['marisol', 86, -0.3],
    ['osprey', 116, 0.5], ['petrel', 148, -0.4], ['cormorant', 184, 0.2],
  ];
  for (const [id, dz, ox] of ahead) {
    const t = new Vehicle(game.world, vehicleSpec(id), lane + ox, z + dz, 0);
    t.vx = 0; t.vz = 19; t.driver = 'ai';
    t.ai = { kind: 'cruise' };
    t.brakeLight = true;
    game.vehicles.push(t);
  }
  // oncoming lane, headlights toward the camera
  const towards = [
    ['barracuda', 30, 0.3], ['tern', 62, -0.4], ['petrel', 96, 0.3],
    ['marisol', 132, -0.3], ['pelican', 172, 0.2],
  ];
  for (const [id, dz, ox] of towards) {
    const t = new Vehicle(game.world, vehicleSpec(id), oncoming + ox, z + dz, Math.PI);
    t.vx = 0; t.vz = -22; t.driver = 'ai';
    t.ai = { kind: 'cruise' };
    game.vehicles.push(t);
  }
  // kerbside parking both sides
  const parkedCars = [
    ['petrel', x - 5.4, z + 16, 0], ['tern', x + 5.9, z + 6, 0],
    ['pelican', x - 5.4, z + 54, 0], ['marisol', x + 5.9, z + 68, 0],
    ['osprey', x - 5.4, z + 108, 0],
  ];
  for (const [id, px, pz, yaw] of parkedCars) {
    const t = new Vehicle(game.world, vehicleSpec(id), px, pz, yaw);
    t.parked = true;
    game.vehicles.push(t);
  }
  // a crowd walking the strip
  for (let i = 0; i < 18; i++) {
    const side = i % 2 ? 1 : -1;
    placePedAt(game, x + side * (8.6 + (i % 4) * 0.8), z - 4 + i * 5.6,
      side > 0 ? Math.PI * 0.87 : Math.PI * 0.13, {
        shirt: [[0.86, 0.74, 0.58], [0.32, 0.40, 0.50], [0.70, 0.34, 0.30], [0.38, 0.56, 0.48]][i % 4],
      });
  }

  const CAM = [lane - 0.9, 5.2, z - 12];
  const TGT = [lane + 0.1, 1.3, z + 47];
  game.cam.yaw = 0;
  game.cam.pitch = -0.075;
  game.cam.pos = CAM;
  game.cam.target = TGT;
  game.cam.fov = 1.02;
  game.cam.snap = false;
  game.hud.objective('Cruise the boulevard — the marina is south', 'FREEROAM');
  game.hud.toast('Sunset on Cobalt Boulevard', 'info', 99);
  game.missionMarker = null;

  game.shotTick = (g) => {
    const v = g.player.vehicle;
    v.x = lane; v.z = z; v.yaw = 0;
    v.vx = 0; v.vz = 33;
    v.steer = 0.05; v.driftAmount = 0.16; v.pitch = 0;
    g.player.x = v.x; g.player.z = v.z;
    // the staged cars would otherwise drift out of frame during the settle ticks
    g.vehicles.forEach((c) => {
      if (c === v || !c.ai || c.ai.kind !== 'cruise') return;
      c.vx = 0;
      c.vz = Math.cos(c.yaw) > 0 ? 19 : -22;
    });
    g.cam.pos = CAM;
    g.cam.target = TGT;
    g.cam.yaw = 0; g.cam.pitch = -0.075; g.cam.fov = 1.02;
    g.world.clock = 18.5;
  };
}

function setupMissionShot(game) {
  game.cam.frozen = true;
  // armed confrontation outside the Lantern Club, guards in the street
  const lm = game.world.landmarks;
  const cx = lm.club[0], cz = lm.club[1] + 18;
  game.player.spawn(cx - 4, cz + 12, Math.PI);
  game.player.aiming = true;
  game.player.aimYaw = Math.PI;
  game.player.yaw = Math.PI;
  game.player.equip('smg');
  game.player.ammo.smg.mag = 24;
  game.player.health = 62;
  game.player.armor = 40;
  game.police.level = 2;
  game.police.meter = 0.6;

  // the club's neon behind the fighters
  game.missionMarker = { x: cx, z: cz - 2 };

  game.spawnGuardWave(cx + 2, cz - 12, 3, 'ferro');
  game.spawnGuardWave(cx - 9, cz - 8, 2, 'ferro');
  game.guards[0].yaw = 0; game.guards[1].yaw = 0.2;

  // one cruiser slewed across the street with its lights on
  const cop = new Vehicle(game.world, vehicleSpec('warden'), cx + 12, cz - 6, Math.PI * 0.62);
  cop.ai = { kind: 'chase' };
  cop.driver = 'ai';
  cop.siren = 0.5;
  cop.braking = true;
  game.vehicles.push(cop);
  game.police.units.push({ car: cop, dismounted: false, officer: null });
  game.police.officers.push(makeOfficer(game, cx + 8, cz - 2, Math.PI * 0.8));
  game.police.officers.push(makeOfficer(game, cx - 7, cz - 4, Math.PI));

  // a couple of civilians running
  for (let i = 0; i < 5; i++) {
    placePedAt(game, cx + (i - 2) * 5.5, cz - 20 - (i % 3) * 4, Math.PI + (i % 2 ? 0.8 : -0.7), {});
  }

  game.cam.yaw = Math.PI + 0.03;
  game.cam.pitch = -0.05;
  game.cam.pos = [cx - 1.6, 2.05, cz + 9.5];
  game.cam.target = [cx, 1.55, cz - 12];
  game.cam.fov = 1.0;
  game.cam.snap = false;
  game.hud.objective('Clear the Ferro crew off the pier', 'JOB 06 · LANTERN ROW');
  game.hud.toast('Nardo Ferro steps out of the light', 'warn', 99);
  game.shotTick = (g) => {
    const p = g.player;
    p.aiming = true; p.aimYaw = Math.PI; p.yaw = Math.PI;
    p.fireCooldown = 0.2;
    g.cam.pos = [cx - 1.6, 2.05, cz + 9.5];
    g.cam.target = [cx, 1.5, cz - 12];
    g.cam.yaw = Math.PI + 0.02;
    g.cam.pitch = -0.04;
    g.cam.fov = 1.0;
  };
}

function setupVistaShot(game) {
  game.cam.frozen = true;
  // hero establishing view: high over the beach boulevard at sunset, looking
  // north up a traffic-filled avenue into the downtown core. The bay sits behind
  // the camera so the frame is city, not empty water.
  const x = ROAD(4);
  const zEye = 236;
  const bank = game.world.landmarks.bank;
  game.player.spawn(x + 6, zEye - 40, Math.PI);
  game.police.level = 1;
  game.world.clock = 18.42;
  game.fogOverride = 780;
  game.sunOverride = { az: 3.12, el: 0.075 };

  // populate the avenue: two lanes of traffic plus kerbside parking. The lanes
  // start behind the camera so the near foreground is busy too, not just the
  // middle distance.
  const laneA = x + 3.2, laneB = x - 3.2;
  const specs = ['petrel', 'marisol', 'tern', 'pelican', 'osprey', 'cormorant', 'barracuda'];
  let k = 0;
  for (let i = 0; i < 26; i++) {
    const t = new Vehicle(game.world, vehicleSpec(specs[k++ % specs.length]), laneA, zEye + 30 - i * 12, 0);
    t.vz = 16; t.vx = 0; t.driver = 'ai'; t.ai = { kind: 'cruise' };
    game.vehicles.push(t);
  }
  for (let i = 0; i < 26; i++) {
    const t = new Vehicle(game.world, vehicleSpec(specs[k++ % specs.length]), laneB, zEye + 22 - i * 13, Math.PI);
    t.vz = -18; t.vx = 0; t.driver = 'ai'; t.ai = { kind: 'cruise' };
    game.vehicles.push(t);
  }
  // cross traffic on the two junctions the avenue runs through
  const crossZ = [zEye - 80, zEye - 240];
  for (let c = 0; c < 2; c++) {
    for (let i = 0; i < 3; i++) {
      const t = new Vehicle(game.world, vehicleSpec(specs[k++ % specs.length]), x - 34 + i * 24, crossZ[c] + (i % 2 ? 3.4 : -3.4), Math.PI / 2);
      t.vz = 0; t.vx = 12; t.driver = 'ai'; t.ai = { kind: 'cruise' };
      game.vehicles.push(t);
    }
  }
  for (let i = 0; i < 10; i++) {
    const side = i % 2 ? 1 : -1;
    const t = new Vehicle(game.world, vehicleSpec(specs[k++ % specs.length]), x + side * 9.2, zEye - 14 - i * 17, side > 0 ? 0 : Math.PI);
    t.parked = true;
    game.vehicles.push(t);
  }
  // and a crowd along both kerbs
  for (let i = 0; i < 26; i++) {
    const side = i % 2 ? 1 : -1;
    placePedAt(game, x + side * (10.2 + (i % 3) * 0.7), zEye - 8 - i * 6.4, side > 0 ? Math.PI * 0.9 : Math.PI * 0.1, {
      shirt: [[0.86, 0.74, 0.58], [0.32, 0.40, 0.50], [0.70, 0.34, 0.30], [0.38, 0.56, 0.48], [0.62, 0.60, 0.34]][i % 5],
    });
  }

  const CAM = [x + 11.5, 22, zEye + 2];
  const TGT = [x - 4, 7, zEye - 410];
  game.cam.pos = CAM;
  game.cam.target = TGT;
  game.cam.yaw = 0;
  game.cam.pitch = -0.03;
  game.cam.fov = 1.02;
  game.cam.snap = false;
  game.hud.objective('Explore Cobalt Bay', 'FREEROAM');
  game.hud.toast('Cobalt Bay · Solana Strip · Pier Nine', 'info', 99);
  game.missionMarker = null;
  game.shotTick = (g) => {
    g.vehicles.forEach((c) => {
      if (!c.ai || c.ai.kind !== 'cruise') return;
      if (Math.abs(c.vx) > 1) c.vx = 12;
      else c.vz = Math.cos(c.yaw) > 0 ? 16 : -18;
    });
    g.cam.pos = CAM;
    g.cam.target = TGT;
    g.cam.fov = 1.02;
    g.cam.pitch = -0.03;
    g.world.clock = 18.42;
  };
}

// ---------------------------------------------------------------------- entry

const game = new Game();
window.__game = game;
game.boot().catch((err) => {
  console.error(err);
  window.__shotError = String(err && err.stack || err);
  const l = document.getElementById('loading');
  if (l) l.textContent = 'Cobalt Bay failed to start: ' + (err && err.message ? err.message : err);
});
