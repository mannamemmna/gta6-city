// The player: on foot and behind the wheel. Owns health, stamina, the weapon
// wheel, the enter/exit dance, and the on-foot movement that resolves against the
// city's collision boxes.

import { PLAYER, WEAPONS } from './config.js';
import { angleDelta, clamp, damp, lerp } from './math3d.js';
import { drawPerson } from './models.js';

export class Player {
  constructor(world) {
    this.world = world;
    this.x = 0; this.y = 0; this.z = 0;
    this.vx = 0; this.vz = 0; this.vy = 0;
    this.yaw = 0;
    this.aimYaw = 0;
    this.health = PLAYER.health;
    this.armor = 0;
    this.money = 250;
    this.stamina = 1;
    this.onGround = true;
    this.crouch = false;
    this.aiming = false;
    this.moving = 0;
    this.phase = 0;
    this.vehicle = null;
    this.dead = false;
    this.deadTimer = 0;
    this.radius = PLAYER.radius;
    this.gun = 'pistol';
    this.ammo = {
      pistol: { mag: WEAPONS.pistol.mag, reserve: 72 },
      smg: { mag: 0, reserve: 0 },
      shotgun: { mag: 0, reserve: 0 },
    };
    this.fireCooldown = 0;
    this.reloadTimer = 0;
    this.shirt = [0.78, 0.34, 0.26];
    this.pants = [0.20, 0.24, 0.30];
    this.skin = [0.86, 0.68, 0.50];
    this.hair = [0.10, 0.09, 0.08];
    this.entering = 0;
    this.wanted = 0;
    this.wantedMeter = 0;
    this.inWater = false;
    this.footsteps = 0;
  }

  spawn(x, z, yaw = 0) {
    this.x = x; this.z = z; this.yaw = yaw; this.aimYaw = yaw;
    this.y = this.world.groundAt(x, z);
    this.vx = 0; this.vz = 0; this.vy = 0;
    this.dead = false;
    this.health = PLAYER.health;
  }

  get speed() { return Math.hypot(this.vx, this.vz); }
  get pos() { return [this.x, this.y + 1.35, this.z]; }

  currentWeapon() { return WEAPONS[this.gun]; }

  equip(name) {
    if (!WEAPONS[name]) return;
    this.gun = name;
    this.reloadTimer = 0;
  }

  giveAmmo(name, rounds) {
    if (this.ammo[name]) this.ammo[name].reserve = Math.min(999, this.ammo[name].reserve + rounds);
  }

  damage(amount, from) {
    if (this.dead) return;
    if (this.armor > 0) {
      const absorbed = Math.min(this.armor, amount * 0.6);
      this.armor -= absorbed;
      amount -= absorbed;
    }
    this.health -= amount;
    if (from) this.lastHitFrom = { x: from.x, z: from.z, t: 0 };
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      this.deadTimer = 0;
      if (this.vehicle) this.vehicle.eject();
    }
  }

  reload() {
    const w = this.currentWeapon();
    const a = this.ammo[this.gun];
    if (a.mag >= w.mag || a.reserve <= 0 || this.reloadTimer > 0) return;
    this.reloadTimer = this.gun === 'shotgun' ? 1.15 : 0.95;
    this.reloadTarget = this.gun;
  }

  canFire() {
    const a = this.ammo[this.gun];
    return !this.dead && this.fireCooldown <= 0 && this.reloadTimer <= 0 && a.mag > 0;
  }

  consumeShot() {
    const a = this.ammo[this.gun];
    a.mag = Math.max(0, a.mag - 1);
    this.fireCooldown = 60 / this.currentWeapon().rpm;
  }

  update(dt, input, cam, game) {
    if (this.dead) {
      this.deadTimer += dt;
      this.moving = 0;
      return;
    }
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    if (this.reloadTimer > 0) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) {
        const w = WEAPONS[this.reloadTarget];
        const a = this.ammo[this.reloadTarget];
        const need = w.mag - a.mag;
        const take = Math.min(need, a.reserve);
        a.mag += take;
        a.reserve -= take;
      }
    }
    if (this.lastHitFrom) this.lastHitFrom.t += dt;

    if (this.vehicle) return; // the vehicle module drives

    const { x: ax, y: ay } = input.axis();
    const wantAim = input.mouseDown || input.down('KeyQ');
    this.aiming = wantAim && this.onGround;
    this.crouch = false;

    // camera-relative movement basis
    const cy = cam.yaw;
    const fwd = [-Math.sin(cy), Math.cos(cy)];
    const right = [-Math.cos(cy), -Math.sin(cy)];
    let dx = fwd[0] * ay + right[0] * ax;
    let dz = fwd[1] * ay + right[1] * ax;
    const mag = Math.hypot(dx, dz);
    if (mag > 1) { dx /= mag; dz /= mag; }
    const inputMag = Math.min(1, mag);

    const running = input.down('ShiftLeft') && inputMag > 0.1 && !this.aiming;
    let speedTarget = this.aiming ? PLAYER.walk * 0.62 : running ? PLAYER.run : PLAYER.walk;
    if (this.inWater) speedTarget = PLAYER.swim;
    if (running && !this.inWater) {
      this.stamina = Math.max(0, this.stamina - dt * 0.16);
      if (this.stamina <= 0) speedTarget = PLAYER.walk;
    } else {
      this.stamina = Math.min(1, this.stamina + dt * 0.12);
    }

    const accel = this.onGround ? 26 : 6;
    this.vx = damp(this.vx, dx * speedTarget * inputMag, accel * 0.35, dt);
    this.vz = damp(this.vz, dz * speedTarget * inputMag, accel * 0.35, dt);

    // face the movement, or face the camera when aiming
    if (this.aiming) {
      this.yaw = cy;
    } else if (inputMag > 0.15) {
      const targetYaw = Math.atan2(-dx, dz);
      this.yaw += angleDelta(this.yaw, targetYaw) * Math.min(1, dt * 12);
    }

    // integrate with collision
    let nx = this.x + this.vx * dt;
    let nz = this.z + this.vz * dt;
    const [rx, rz] = this.world.colliders.resolve(nx, nz, this.radius);
    if (Math.abs(rx - nx) > 1e-6) this.vx *= 0.2;
    if (Math.abs(rz - nz) > 1e-6) this.vz *= 0.2;
    nx = rx; nz = rz;

    // water: swim, don't walk on the seabed
    const g = this.world.groundAt(nx, nz);
    this.inWater = g < this.world.waterY - 0.05;
    if (this.inWater) {
      this.y = damp(this.y, this.world.waterY - 0.85, 4, dt);
      this.vy = 0;
      this.onGround = false;
    } else {
      if (this.y > g + 0.2) {
        this.vy -= PLAYER.gravity * dt;
        this.onGround = false;
      } else {
        this.y = g; this.vy = 0; this.onGround = true;
      }
      if (input.hit('Space') && this.onGround) { this.vy = PLAYER.jump; this.onGround = false; }
      this.y += this.vy * dt;
      if (this.y <= g) { this.y = g; this.vy = 0; this.onGround = true; }
    }

    this.x = nx; this.z = nz;

    const sp = this.speed;
    this.moving = clamp(sp / PLAYER.run, 0, 1);
    this.phase += dt * (0.5 + this.moving * 2.2);

    // entering a car
    if (input.hit('KeyF')) game.tryEnterVehicle();
    if (input.hit('KeyR')) this.reload();
    if (input.hit('Digit1')) this.equip('pistol');
    if (input.hit('Digit2') && this.ammo.smg.reserve + this.ammo.smg.mag > 0) this.equip('smg');
    if (input.hit('Digit3') && this.ammo.shotgun.reserve + this.ammo.shotgun.mag > 0) this.equip('shotgun');
  }

  draw(buf) {
    drawPerson(buf, {
      x: this.x, y: this.y, z: this.z, yaw: this.aiming ? this.aimYaw : this.yaw,
      shirt: this.shirt, pants: this.pants, skin: this.skin, hair: this.hair,
      phase: this.phase, moving: this.moving, aim: this.aiming,
      gun: this.gun !== 'pistol' || true, armed: true, down: this.dead,
    });
  }

  serialize() {
    return {
      x: this.x, z: this.z, yaw: this.yaw, health: this.health, armor: this.armor,
      money: this.money, gun: this.gun, ammo: this.ammo, wanted: this.wanted,
    };
  }
  restore(s) {
    this.x = s.x; this.z = s.z; this.yaw = s.yaw;
    this.y = this.world.groundAt(s.x, s.z);
    this.health = s.health; this.armor = s.armor; this.money = s.money;
    this.gun = s.gun ?? 'pistol';
    this.ammo = s.ammo ?? this.ammo;
    this.wanted = s.wanted ?? 0;
    this.dead = false;
  }
}
