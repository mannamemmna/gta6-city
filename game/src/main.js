// Boot: builds the world (city, traffic, crowd, police, missions, HUD), owns the fixed-step loop and
// the game state machine (title, play, paused, dead), and routes input to whatever is in charge — the
// player on foot or the car they are driving. `?shot=` stages a deterministic state for a screenshot
// and sets window.__shotReady once two real frames have been rendered.
import * as THREE from 'three';
import { STEP, PLAYER } from './config.js';
import { createRenderer, createEnvironment, createDistantHills } from './render.js';
import { createCity } from './city.js';
import { createFoliage } from './foliage.js';
import { Player } from './player.js';
import { TrafficSystem } from './traffic.js';
import { PedestrianSystem } from './pedestrians.js';
import { PoliceSystem } from './police.js';
import { CombatSystem } from './combat.js';
import { MissionSystem } from './missions.js';
import { Hud } from './hud.js';
import { Menus } from './menus.js';
import { AudioSystem } from './audio.js';
import { ThirdPersonCamera } from './camera.js';
import { createInput } from './input.js';
import { Car } from './vehicles.js';
import { stageShot } from './shots.js';

const MAX_FRAME = 0.1;
const canvas = document.getElementById('game');
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '', 10) || 1337;

const renderer = createRenderer(canvas);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.25, 2400);
const env = createEnvironment(scene, seed);
env.setTimeOfDay('golden');
createDistantHills(scene, seed + 3);

const city = createCity(seed, scene);
const foliage = createFoliage(city, scene, seed + 17);
const player = new Player(city, { x: -38, z: 40, heading: Math.PI });
scene.add(player.group);
const traffic = new TrafficSystem(city, scene, seed + 7);
const peds = new PedestrianSystem(city, scene, seed + 11);
const police = new PoliceSystem(city, scene, seed + 13);
const combat = new CombatSystem(city, scene);
combat.bind(peds, police, traffic);
const missions = new MissionSystem(city, scene);
const hud = new Hud(city);
const audio = new AudioSystem();
const input = createInput(canvas);
const cam = new ThirdPersonCamera(camera, city);

const game = {
  scene, camera, renderer, env, city, player, traffic, peds, police, combat, missions, hud, audio, input, cam,
  clockSeconds: 0,
  timeOfDay: 'golden',
  paused: false,
  over: false,
  deathTimer: 0,
  lastCar: null,
  missionIndex: 0,
};

// ------------------------------------------------------------------ wiring callbacks
police.onArrest = () => bust();
police.onShot = () => audio.play('shot', 0.4);
missions.onBanner = (kicker, title, t) => hud.banner(kicker, title, t);
missions.onSay = (who, text) => { hud.say(who, text); };
missions.onToast = (text) => hud.toast(text);
missions.onReward = (amount) => {
  player.money += amount;
  player.health = Math.min(PLAYER.health, player.health + 18);
  hud.toast(`+$${amount.toLocaleString('en-US')}`, 3.2);
  audio.play('cash');
};
missions.audio = audio;
missions.police = police;
missions.combat = combat;
combat.onKill = ({ kind }) => {
  if (kind === 'ped') { player.money += 15; police.addWanted(1, 'shots fired'); }
  if (kind === 'officer') police.addWanted(3, 'officer down');
};
combat.policeSystem = police;
combat.onExplosion = (x, z) => {
  cam.addShake(0.3);
  if (Math.hypot(player.x - x, player.z - z) < 8) player.hurt(25);
  police.addWanted(1, 'explosion');
};

// ------------------------------------------------------------------ combat: player shots
const fireCooldown = { t: 0 };
function playerShoot() {
  const origin = player.car ? { x: player.car.x, y: 1.2, z: player.car.z } : player.muzzle();
  // aim along the camera's centre ray so the crosshair is truthful
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const originV = { x: origin.x, y: origin.y, z: origin.z };
  const dirV = { x: dir.x, y: dir.y, z: dir.z };
  // mission enemies take priority over the world hit
  const enemyHit = missions.hitEnemy(originV, dirV, PLAYER.weaponRange);
  const result = combat.fire(originV, dirV, { fromPlayer: true });
  if (enemyHit && enemyHit.t < 200 && (!result.hit || enemyHit.t < 200)) {
    // if the bullet reached the enemy before anything else, kill them
    if (!result.hit || enemyHit.t < distanceOf(result.end, originV) + 0.4) missions.killEnemy(enemyHit.enemy);
  }
  cam.addShake(0.06);
  audio.play('shot');
  if (player.ammo > 0) player.ammo -= 1;
}

function distanceOf(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }

// ------------------------------------------------------------------ car enter/exit
function tryEnterCar() {
  if (player.car) return;
  const car = traffic.nearestCar(player.x, player.z, 4.2);
  if (!car) return;
  player.car = car;
  car.occupant = 'player';
  car.parked = false;
  audio.play('door');
  hud.toast(`Stole ${car.spec.name}`, 1.8);
  police.addWanted(1, 'grand theft auto');
}
function exitCar() {
  if (!player.car) return;
  const car = player.car;
  car.occupant = null;
  car.parked = true;
  car.speed = 0;
  player.car = null;
  player.x = car.x - Math.sin(car.heading) * 2.1;
  player.z = car.z - Math.cos(car.heading) * 2.1;
  player.heading = car.heading;
  player.place(player.x, player.z, car.heading);
  audio.play('door');
}

function bust() {
  hud.banner('BUSTED', 'Vela Costa Police', 3.4);
  player.health = 100;
  player.armor = 0;
  police.setWanted(0);
  player.money = Math.max(0, player.money - 250);
  player.car && exitCar();
  const jail = { x: -60, z: 20 };
  player.place(jail.x, jail.z, 0);
  audio.play('fail');
}

function wasted() {
  hud.banner('WASTED', 'Marisol Heat', 3.2);
  game.over = true;
  game.deathTimer = 2.6;
  audio.play('fail');
}

// ------------------------------------------------------------------ car physics integration
function drivePlayerCar(dt) {
  const car = player.car;
  const axis = input.axis();
  const throttle = axis.forward;
  const steer = -axis.strafe;
  const handbrake = input.isDown('Space');
  car.drive(dt, throttle, steer, handbrake);
  const hit = car.resolveBoxes(city.colliders);
  if (hit && Math.abs(car.speed) > 12) { cam.addShake(0.22); player.hurt(2); }
  // pushing pedestrians: casualties raise heat
  for (const ped of peds.peds) {
    if (ped.dead) continue;
    const d = Math.hypot(car.x - ped.x, car.z - ped.z);
    if (d < 1.9 && Math.abs(car.speed) > 6) {
      peds.kill(ped);
      police.addWanted(2, 'vehicular homicide');
      audio.play('hit');
      cam.addShake(0.16);
    }
  }
  // traffic collisions
  for (const other of traffic.cars) {
    if (other === car || other.occupant) continue;
    const d = Math.hypot(car.x - other.x, car.z - other.z);
    if (d < 3.0) {
      const nx = (car.x - other.x) / (d || 1);
      const nz = (car.z - other.z) / (d || 1);
      car.x += nx * (3.0 - d) * 0.6;
      car.z += nz * (3.0 - d) * 0.6;
      car.speed *= 0.55;
      other.x -= nx * (3.0 - d) * 0.4;
      other.z -= nz * (3.0 - d) * 0.4;
      if (Math.abs(car.speed) > 8) cam.addShake(0.2);
    }
  }
  // keep the car on the map and out of the sea
  if (car.z > city.waterZ + 4) { car.z = city.waterZ + 4; car.speed *= 0.2; }
  car.updateVisual(dt);
}

// ------------------------------------------------------------------ camera
function updateCamera(dt) {
  if (cam.override) {
    camera.position.set(cam.override.pos.x, cam.override.pos.y, cam.override.pos.z);
    camera.lookAt(cam.override.look.x, cam.override.look.y, cam.override.look.z);
    if (Math.abs(camera.fov - 52) > 0.01) { camera.fov = 52; camera.updateProjectionMatrix(); }
    return;
  }
  if (player.car) {
    const car = player.car;
    const anchor = { x: car.x, y: 0, z: car.z };
    // let the mouse orbit while driving, but slowly recentre behind the car
    const m = input.takeMouse();
    cam.orbit(m.x, m.y);
    if (!input.locked) cam.yaw += 0;
    cam.update(dt, anchor, {
      distance: 8.6 + Math.abs(car.speed) * 0.075,
      targetHeight: 1.5,
      heightBias: 0.16,
      fov: 60,
      speed: Math.abs(car.speed),
      driving: true,
    });
  } else {
    const m = input.takeMouse();
    cam.orbit(m.x, m.y);
    cam.update(dt, { x: player.x, y: player.y, z: player.z }, {
      distance: player.aiming ? 3.4 : 5.1,
      targetHeight: 1.5,
      heightBias: 0.1,
      fov: 62,
      speed: 0,
    });
  }
}

// ------------------------------------------------------------------ the loop
let accumulator = 0;
let last = performance.now();
let frames = 0;

function stepGame(dt) {
  game.clockSeconds += dt;
  const axis = input.axis();
  if (player.car) {
    drivePlayerCar(dt);
    // steering the car aligns the camera behind it over time
    cam.yaw += ((((player.car.heading + Math.PI) - cam.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * Math.min(1, dt * 1.6);
    player.x = player.car.x;
    player.z = player.car.z;
    player.heading = player.car.heading;
    player.rig.group.position.set(player.car.x, 0, player.car.z);
    player.rig.group.rotation.y = player.car.heading;
    if (input.pressed('KeyF')) { audio.play('horn'); }
  } else {
    const moved = player.move(dt, cam.yaw, {
      forward: axis.forward, strafe: axis.strafe, sprint: input.sprinting(),
      jump: input.takePressed('Space'), aiming: input.aiming,
    }, city.colliders);
    if (moved === 'step') audio.play('step');
  }

  // firing
  fireCooldown.t -= dt;
  if (!player.car && input.firing && fireCooldown.t <= 0 && player.ammo > 0 && !player.dead) {
    fireCooldown.t = PLAYER.fireRate;
    playerShoot();
  }
  if (!player.car && player.ammo === 0 && input.firing && fireCooldown.t <= 0) {
    fireCooldown.t = 0.6;
    player.ammo = 34;
    player.ammoReserve = Math.max(0, player.ammoReserve - 34);
    hud.toast('Reloaded', 1.2);
  }

  traffic.update(dt, player);
  peds.update(dt, player);
  police.update(dt, player, combat, audio);
  missions.update(dt, game);
  combat.update(dt);

  game.timeOfDay = game.timeOfDay;
  env.update(dt, player.car ? { x: player.car.x, y: 0, z: player.car.z } : { x: player.x, y: 0, z: player.z });
  const nearPolice = police.cruisers.some((c) => Math.hypot(c.car.x - player.x, c.car.z - player.z) < 70);
  audio.update(dt, { speed: player.car ? player.car.speed : 0, inCar: !!player.car, wanted: police.wanted, nearPolice });

  if (player.dead && !game.over) wasted();
  if (game.over) {
    game.deathTimer -= dt;
    if (game.deathTimer <= 0) respawn();
  }
  if (player.health < 26 && !player.car) hud.el.health.style.filter = 'saturate(1.6)';
}

function respawn() {
  game.over = false;
  player.dead = false;
  player.health = PLAYER.health;
  player.armor = 0;
  player.rig.rig.rotation.x = 0;
  player.rig.rig.position.y = 0;
  if (player.car) exitCar();
  player.place(-38, 40, Math.PI);
  police.setWanted(0);
  player.money = Math.max(0, player.money - 300);
  hud.banner('HOSPITAL', 'Patch up on your dime', 2.6);
}

function handleInput() {
  if (input.pressed('KeyE')) {
    if (player.car) exitCar(); else tryEnterCar();
  }
  if (input.pressed('KeyEscape')) {
    menus.openPause();
    input.releaseLock();
  }
  if (input.pressed('KeyM')) hud.headingUp = !hud.headingUp;
  if (input.pressed('Space') && !player.car) { /* jump handled in player.move */ }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(MAX_FRAME, (now - last) / 1000);
  last = now;
  if (menus.mode === 'play' && !game.paused) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= STEP && steps < 4) {
      stepGame(STEP);
      accumulator -= STEP;
      steps += 1;
    }
    handleInput();
  } else {
    // title backdrop: keep the world alive so traffic and the sea move behind the menu
    accumulator = 0;
    const idle = Math.min(dt, 0.05);
    traffic.update(idle, player);
    peds.update(idle, player);
    env.update(idle, { x: 0, y: 0, z: -20 });
    combat.update(idle);
  }
  updateCamera(dt);
  hud.update(dt, game);
  renderer.toneMappingExposure = env.exposure;
  renderer.render(scene, camera);
  frames += 1;
  input.endFrame();
}

// ------------------------------------------------------------------ responsive
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ------------------------------------------------------------------ menus + start
const menus = new Menus(game);
menus.onStart = (save) => {
  audio.start();
  if (save) applySave(save);
  input.requestLock();
  hud.setVisible(true);
};
menus.onResume = () => { audio.start(); input.requestLock(); };
menus.onQuit = () => { input.releaseLock(); };

document.getElementById('minimap-wrap').addEventListener('click', () => { hud.headingUp = !hud.headingUp; });
canvas.addEventListener('click', () => {
  if (menus.mode === 'play') input.requestLock();
});

function applySave(save) {
  player.money = save.money ?? 500;
  player.health = save.health ?? 100;
  player.armor = save.armor ?? 0;
  player.ammo = save.ammo ?? 34;
  player.armor = save.armor ?? 0;
  player.place(save.x ?? -38, save.z ?? 40, save.heading ?? Math.PI);
  missions.index = save.missionIndex ?? 0;
  missions.state = 'idle';
  missions.active = null;
  missions.showContact();
  police.setWanted(save.wanted ?? 0);
  hud.toast('Welcome back to Vela Costa', 2.4);
}

game.snapshot = () => ({
  x: player.x, z: player.z, heading: player.heading,
  money: player.money, health: player.health, armor: player.armor, ammo: player.ammo,
  missionIndex: missions.index, wanted: police.wanted,
  missionTitle: missions.nextUp()?.title ?? 'Vela Costa',
  clockSeconds: game.clockSeconds,
});

// ------------------------------------------------------------------ screenshot staging
if (shot) {
  document.getElementById('title').classList.add('hidden');
  hud.setVisible(true);
  if (params.get('tod')) env.setTimeOfDay(params.get('tod'));
  stageShot(shot, game, { input, cam, hud, menus });
  let painted = 0;
  let snapshotInfo = null;
  function paint() {
    requestAnimationFrame(paint);
    env.update(1 / 60, player.car ? { x: player.car.x, y: 0, z: player.car.z } : { x: player.x, y: 0, z: player.z });
    updateCamera(1 / 60);
    hud.update(1 / 60, game);
    renderer.toneMappingExposure = env.exposure;
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 3) {
      snapshotInfo = {
        shot, pos: [Math.round(player.x), Math.round(player.z)],
        inCar: !!player.car, wanted: police.wanted, mission: missions.active?.id ?? null,
        peds: peds.liveCount(), cars: traffic.cars.length, money: player.money,
      };
      window.__shotReady = true;
    }
    if (painted >= 6) window.__shotReady = true;
  }
  window.__shotInfo = () => snapshotInfo;
  requestAnimationFrame(paint);
  // Headless Chrome reports document.hidden = true and never fires requestAnimationFrame, so a
  // capture would hang waiting for __shotReady. Drive the same paint loop from a timer as well.
  setInterval(() => {
    if (document.hidden && painted < 6) paint();
  }, 40);
} else {
  hud.setVisible(false);
  requestAnimationFrame(frame);
}

window.__game = game;
