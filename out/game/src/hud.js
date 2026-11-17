// The HUD: a rotating minimap drawn from the baked city map with blips for the player, police,
// traffic, mission markers and contacts; wanted stars; health and armour; money; the clock; the
// speedometer; the mission objective panel; dialogue; toasts and mission banners. All the DOM reads
// happen once and are cached, so the per-frame cost is a couple of canvas 2D calls.
import * as THREE from 'three';

const BLIP = {
  player: '#ffffff',
  police: '#3f8dff',
  ped: '#c9bda9',
  car: '#8fb8c8',
  mission: '#ffcf4a',
  contact: '#7ce0a0',
  target: '#ff5f5e',
  health: '#7ce0a0',
  store: '#e8a0ff',
};

export class Hud {
  constructor(city) {
    this.city = city;
    this.el = {
      stars: document.getElementById('stars'),
      clock: document.getElementById('clock'),
      money: document.getElementById('money'),
      health: document.getElementById('health-fill'),
      armor: document.getElementById('armor-fill'),
      ammo: document.getElementById('ammo'),
      ammoWrap: document.querySelector('.weapon-ammo'),
      weapon: document.getElementById('weapon'),
      speedo: document.getElementById('speedo'),
      speedValue: document.getElementById('speed-value'),
      speedArc: document.getElementById('spd-arc'),
      vehicleName: document.getElementById('vehicle-name'),
      objTitle: document.getElementById('obj-title'),
      objText: document.getElementById('obj-text'),
      objKicker: document.querySelector('.obj-kicker'),
      district: document.getElementById('district'),
      dialogue: document.getElementById('dialogue'),
      dlgWho: document.getElementById('dlg-who'),
      dlgText: document.getElementById('dlg-text'),
      toast: document.getElementById('toast'),
      banner: document.getElementById('banner'),
      bannerKicker: document.getElementById('banner-kicker'),
      bannerTitle: document.getElementById('banner-title'),
      prompt: document.getElementById('prompt'),
      crosshair: document.getElementById('crosshair'),
      minimap: document.getElementById('minimap'),
      minimapWrap: document.getElementById('minimap-wrap'),
      hud: document.getElementById('hud'),
    };
    this.mctx = this.el.minimap.getContext('2d');
    this.starEls = [];
    for (let i = 0; i < 5; i += 1) {
      const s = document.createElement('i');
      this.el.stars.appendChild(s);
      this.starEls.push(s);
    }
    this.toastTimer = 0;
    this.bannerTimer = 0;
    this.lastMoney = -1;
    this.lastHealth = -1;
    this.blips = [];
    this.trail = [];
    this.mapCanvas = city.minimap.canvas;
    this.zoom = 2.65;         // world metres -> minimap pixels at playback
    this.headingUp = true;
    this.flashHurt = 0;
    this.mapBackground = document.createElement('canvas');
    this.mapBackground.width = this.el.minimap.width;
    this.mapBackground.height = this.el.minimap.height;
    this.bgReady = false;
  }

  setVisible(v) { this.el.hud.style.display = v ? '' : 'none'; }

  toast(text, seconds = 2.6) {
    this.el.toast.textContent = text;
    this.el.toast.classList.add('show');
    this.toastTimer = seconds;
  }

  banner(kicker, title, seconds = 3.6) {
    this.el.bannerKicker.textContent = kicker;
    this.el.bannerTitle.textContent = title;
    this.el.banner.classList.remove('hidden');
    this.bannerTimer = seconds;
  }

  say(who, text) {
    if (!text) {
      this.el.dialogue.classList.add('hidden');
      return;
    }
    this.el.dlgWho.textContent = who;
    this.el.dlgText.textContent = text;
    this.el.dialogue.classList.remove('hidden');
  }

  prompt(html) {
    if (!html) { this.el.prompt.classList.add('hidden'); return; }
    this.el.prompt.innerHTML = html;
    this.el.prompt.classList.remove('hidden');
  }

  update(dt, game) {
    const p = game.player;
    // stars
    for (let i = 0; i < 5; i += 1) {
      const on = i < game.police.wanted;
      const cls = on ? (game.police.wanted >= 4 ? 'on hot' : 'on') : '';
      if (this.starEls[i].className !== cls) this.starEls[i].className = cls;
    }
    // clock: minutes tick by at 12 game minutes per real minute
    const total = 18 * 60 + 40 + (game.clockSeconds ?? 0) / 10;
    const hh = Math.floor(total / 60) % 24;
    const mm = Math.floor(total % 60);
    const clock = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    if (this.el.clock.textContent !== clock) this.el.clock.textContent = clock;

    // money
    const money = `$${p.money.toLocaleString('en-US')}`;
    if (this.el.money.textContent !== money) {
      this.el.money.textContent = money;
      this.el.money.animate?.([{ transform: 'scale(1.12)' }, { transform: 'scale(1)' }], { duration: 220 });
    }
    // health / armor
    const hp = Math.max(0, Math.round(p.health));
    if (hp !== this.lastHealth) {
      this.el.health.style.width = `${hp}%`;
      this.lastHealth = hp;
    }
    this.el.armor.style.width = `${Math.max(0, Math.round(p.armor))}%`;
    // ammo
    if (this.el.ammo.textContent !== String(p.ammo)) this.el.ammo.textContent = String(p.ammo);
    this.el.ammoWrap.classList.toggle('low', p.ammo <= 3);

    // speedometer in a car
    const inCar = !!p.car;
    this.el.speedo.classList.toggle('hidden', !inCar);
    this.el.weapon.style.display = inCar ? 'none' : '';
    if (inCar) {
      const kmh = Math.round(p.car.speedKmh);
      this.el.speedValue.textContent = String(kmh);
      const frac = Math.min(1, kmh / 140);
      this.el.speedArc.setAttribute('stroke-dasharray', `${(frac * 245).toFixed(1)} 330`);
      if (this.el.vehicleName.textContent !== p.car.spec.name) this.el.vehicleName.textContent = p.car.spec.name;
    }

    // objective panel
    const mission = game.missions.active;
    if (mission) {
      const o = game.missions.objective();
      if (this.el.objTitle.textContent !== o.title) this.el.objTitle.textContent = o.title;
      if (this.el.objText.textContent !== o.text) this.el.objText.textContent = o.text;
      this.el.objKicker.textContent = 'MISSION';
    } else {
      const next = game.missions.nextUp();
      const title = next ? 'Meet ' + next.contact : 'No mission';
      const text = next ? `Go to the green marker to start "${next.title}".` : 'Explore Vela Costa.';
      if (this.el.objTitle.textContent !== title) this.el.objTitle.textContent = title;
      if (this.el.objText.textContent !== text) this.el.objText.textContent = text;
      this.el.objKicker.textContent = 'OBJECTIVE';
    }
    // district label
    const d = this.districtAt(p.x, p.z);
    if (this.el.district.textContent !== d) this.el.district.textContent = d;

    // crosshair: hidden in a car
    this.el.crosshair.style.display = inCar ? 'none' : '';
    this.el.crosshair.style.opacity = p.aiming ? '0.95' : '0.45';

    // toast / banner timing
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.el.toast.classList.remove('show');
    }
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.el.banner.classList.add('hidden');
    }

    this.drawMinimap(game);
  }

  districtAt(x, z) {
    if (z > this.city.beachZ - 4) return 'PLAYA MAREA';
    if (Math.hypot(x, z + 46) < 130) return 'CENTRO';
    if (z < -120) return 'MIRADOR HEIGHTS';
    if (x < -140) return 'BARRIO VIEJO';
    if (x > 140) return 'PUERTO NORTE';
    return 'AVENIDA SOL';
  }

  /** Rotating minimap: the baked city art is redrawn rotated around the player, then blips. */
  drawMinimap(game) {
    const ctx = this.mctx;
    const W = this.el.minimap.width;
    const H = this.el.minimap.height;
    const p = game.player;
    const focusX = p.car ? p.car.x : p.x;
    const focusZ = p.car ? p.car.z : p.z;
    const heading = p.car ? p.car.heading : p.heading;
    const map = this.city.minimap;
    const scale = this.zoom;

    ctx.save();
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0c1218';
    ctx.fillRect(0, 0, W, H);

    // rotate the baked map so the player's facing is up
    ctx.translate(W / 2, H / 2);
    ctx.rotate(-heading);
    ctx.scale(scale, scale);
    ctx.translate(-focusX, -focusZ);
    // the baked map is in its own pixel space; convert its pixel scale into world metres
    const worldPerMapPx = 1 / map.scale;
    ctx.drawImage(
      this.mapCanvas,
      -map.offX * worldPerMapPx,
      -map.offZ * worldPerMapPx,
      this.mapCanvas.width * worldPerMapPx,
      this.mapCanvas.height * worldPerMapPx,
    );
    ctx.restore();

    // blips in screen space: project through the same transform
    const cos = Math.cos(-heading), sin = Math.sin(-heading);
    const toScreen = (x, z) => {
      const dx = (x - focusX) * scale;
      const dz = (z - focusZ) * scale;
      return { x: W / 2 + dx * cos - dz * sin, y: H / 2 + dx * sin + dz * cos };
    };
    // clip to the map square
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.clip();

    const inView = (s) => s.x > -14 && s.x < W + 14 && s.y > -14 && s.y < H + 14;

    // traffic dots
    ctx.fillStyle = 'rgba(200,214,224,0.55)';
    for (const car of game.traffic.cars) {
      if (car.occupant) continue;
      const s = toScreen(car.x, car.z);
      if (!inView(s)) continue;
      ctx.fillRect(s.x - 1.4, s.y - 1.4, 2.8, 2.8);
    }
    // mission markers
    for (const marker of game.missions.markers()) {
      const s = toScreen(marker.x, marker.z);
      if (!inView(s)) continue;
      const pulse = 4.2 + Math.sin(performance.now() / 260) * 1.5;
      ctx.beginPath();
      ctx.arc(s.x, s.y, pulse + 3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,207,74,0.22)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(s.x, s.y, pulse, 0, Math.PI * 2);
      ctx.fillStyle = marker.color ?? BLIP.mission;
      ctx.fill();
      ctx.strokeStyle = 'rgba(20,20,20,0.75)';
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
    // police
    for (const cruiser of game.police.cruisers) {
      const s = toScreen(cruiser.car.x, cruiser.car.z);
      if (!inView(s)) continue;
      const blink = Math.sin(performance.now() / 130) > 0;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 3.6, 0, Math.PI * 2);
      ctx.fillStyle = blink ? '#3f8dff' : '#ff4d4d';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    // officers
    for (const o of game.police.officers) {
      if (o.dead) continue;
      const s = toScreen(o.x, o.z);
      if (!inView(s)) continue;
      ctx.fillStyle = '#3f8dff';
      ctx.fillRect(s.x - 2, s.y - 2, 4, 4);
    }
    // player arrow
    const pS = toScreen(focusX, focusZ);
    ctx.save();
    ctx.translate(pS.x, pS.y);
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5.2, 6);
    ctx.lineTo(0, 3.2);
    ctx.lineTo(-5.2, 6);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();

    // off-screen objectives get a pin pushed to the rim of the radar, so the marker is never lost
    for (const marker of game.missions.markers()) {
      const s = toScreen(marker.x, marker.z);
      if (inView(s)) continue;
      const vx = s.x - W / 2, vy = s.y - H / 2;
      const len = Math.hypot(vx, vy) || 1;
      const r = W * 0.44;
      const ex = W / 2 + (vx / len) * r;
      const ey = H / 2 + (vy / len) * r;
      const ang = Math.atan2(vy, vx);
      ctx.save();
      ctx.translate(ex, ey);
      ctx.rotate(ang);
      ctx.beginPath();
      ctx.moveTo(7, 0);
      ctx.lineTo(-4, 5);
      ctx.lineTo(-4, -5);
      ctx.closePath();
      ctx.fillStyle = marker.color ?? BLIP.mission;
      ctx.fill();
      ctx.strokeStyle = 'rgba(10,12,16,0.8)';
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();

    // rim shading keeps the radar from bleeding into the street behind it
    const rim = ctx.createRadialGradient(W / 2, H / 2, W * 0.30, W / 2, H / 2, W * 0.52);
    rim.addColorStop(0, 'rgba(8,12,18,0)');
    rim.addColorStop(1, 'rgba(8,12,18,0.5)');
    ctx.fillStyle = rim;
    ctx.fillRect(0, 0, W, H);

    // mission clock / wanted tint
    if (game.police.wanted > 0) {
      const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.62);
      g.addColorStop(0, 'rgba(70,120,255,0)');
      g.addColorStop(1, `rgba(70,120,255,${0.16 + Math.sin(performance.now() / 220) * 0.07})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    // north tick, written into the radar itself so heading stays readable when rotating
    const nAngle = -heading - Math.PI / 2;
    ctx.save();
    ctx.translate(W / 2 + Math.cos(nAngle) * W * 0.42, H / 2 + Math.sin(nAngle) * H * 0.42);
    ctx.fillStyle = 'rgba(246,234,214,0.9)';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', 0, 0);
    ctx.restore();
  }
}
