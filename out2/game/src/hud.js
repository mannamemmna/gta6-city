// The HUD is drawn on a second, 2D canvas over the WebGL view: the wanted stars,
// health and armour bars, money, the weapon chip, the objective line, the
// minimap with its wedges and blips, speed and gear in a car, and the toasts.

import { CITY, COP, MONEY } from './config.js';
import { clamp } from './math3d.js';

const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const SERIF = 'Georgia, "Times New Roman", serif';

export class Hud {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.toasts = [];
    this.w = 0; this.h = 0;
    this.dpr = 1;
    this.visible = true;
    this.bigMap = false;
    this.hintTimer = 0;
    this.hint = '';
    this.flash = 0;
    this.flashColor = [255, 255, 255];
    this.minimapScale = 0.62;
  }

  setSize(w, h, dpr) {
    this.w = w; this.h = h; this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.floor(w * dpr));
    this.canvas.height = Math.max(1, Math.floor(h * dpr));
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
  }

  toast(text, kind = 'info', time = 3.2) {
    this.toasts.unshift({ text, kind, life: time, max: time });
    this.toasts = this.toasts.slice(0, 4);
  }

  objective(text, sub = '') {
    this.objText = text;
    this.objSub = sub;
  }

  hitmark() { this.hitFlash = 0.18; }

  update(dt) {
    this.hintTimer = Math.max(0, this.hintTimer - dt);
    this.flash = Math.max(0, this.flash - dt * 2.2);
    this.hitFlash = Math.max(0, (this.hitFlash ?? 0) - dt * 3);
    for (let i = this.toasts.length - 1; i >= 0; i--) {
      this.toasts[i].life -= dt;
      if (this.toasts[i].life <= 0) this.toasts.splice(i, 1);
    }
  }

  draw(game) {
    const ctx = this.ctx;
    const w = this.w, h = this.h;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!this.visible) return;

    const p = game.player;
    const scale = clamp(Math.min(w / 1440, h / 900), 0.72, 1.35);

    // red vignette when hurt
    const hurt = 1 - clamp(p.health / 100, 0, 1);
    if (hurt > 0.12) {
      const g = ctx.createRadialGradient(w / 2, h / 2, h * 0.22, w / 2, h / 2, h * 0.78);
      g.addColorStop(0, 'rgba(120,0,0,0)');
      g.addColorStop(1, `rgba(${120 + 40 * Math.sin(game.time * 6)},0,0,${0.30 * hurt})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(${this.flashColor[0]},${this.flashColor[1]},${this.flashColor[2]},${this.flash * 0.35})`;
      ctx.fillRect(0, 0, w, h);
    }

    this.drawWanted(ctx, game, scale);
    this.drawMoneyAndHealth(ctx, game, scale);
    this.drawWeapon(ctx, game, scale);
    this.drawMinimap(ctx, game, scale);
    this.drawObjective(ctx, game, scale);
    this.drawSpeed(ctx, game, scale);
    this.drawToasts(ctx, scale);
    this.drawCrosshair(ctx, game, scale);
    this.drawHint(ctx, scale);
    this.drawClock(ctx, game, scale);

    if (this.bigMap) this.drawBigMap(ctx, game);

    // cinema bars while a mission card is up
    if (game.missionCardTime > 0) {
      const t = clamp(game.missionCardTime / 0.4, 0, 1);
      const bar = h * 0.11 * t;
      ctx.fillStyle = '#07090d';
      ctx.fillRect(0, 0, w, bar);
      ctx.fillRect(0, h - bar, w, bar);
    }
  }

  drawWanted(ctx, game, s) {
    const lvl = game.police.level;
    const x = 26 * s, y = 22 * s;
    ctx.save();
    for (let i = 0; i < 5; i++) {
      const cx = x + i * 26 * s;
      const cy = y + 12 * s;
      const filled = i < lvl;
      const partial = i === lvl ? game.police.meter : 0;
      this.star(ctx, cx, cy, 11.5 * s, filled ? '#ffd166' : 'rgba(255,255,255,0.14)', filled ? '#a8791f' : 'rgba(255,255,255,0.06)');
      if (partial > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(cx - 12 * s, cy - 12 * s, 24 * s * partial, 24 * s);
        ctx.clip();
        this.star(ctx, cx, cy, 11.5 * s, 'rgba(255,209,102,0.55)', 'rgba(168,121,31,0.5)');
        ctx.restore();
      }
    }
    if (lvl > 0 && Math.sin(game.time * 8) > 0.4) {
      ctx.fillStyle = '#ff6b52';
      ctx.font = `600 ${10 * s}px ${FONT}`;
      ctx.textAlign = 'left';
      ctx.fillText('WANTED', x, y + 38 * s);
    }
    ctx.restore();
  }

  star(ctx, cx, cy, r, fill, stroke) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (Math.PI / 5) * i - Math.PI / 2;
      const rr = i % 2 === 0 ? r : r * 0.45;
      const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }

  drawMoneyAndHealth(ctx, game, s) {
    const p = game.player;
    const x = 26 * s, y = 84 * s;
    ctx.save();
    // health bar
    const bw = 168 * s, bh = 9 * s;
    ctx.fillStyle = 'rgba(0,0,0,0.42)';
    ctx.fillRect(x, y, bw, bh);
    const hp = clamp(p.health / 100, 0, 1);
    const grad = ctx.createLinearGradient(x, 0, x + bw, 0);
    grad.addColorStop(0, hp < 0.3 ? '#e2523f' : '#57d17c');
    grad.addColorStop(1, hp < 0.3 ? '#f08a5d' : '#2fae68');
    ctx.fillStyle = grad;
    ctx.fillRect(x + 1, y + 1, (bw - 2) * hp, bh - 2);
    // armour
    if (p.armor > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.42)';
      ctx.fillRect(x, y + bh + 3 * s, bw, 5 * s);
      ctx.fillStyle = '#61a8e8';
      ctx.fillRect(x + 1, y + bh + 4 * s, (bw - 2) * clamp(p.armor / 100, 0, 1), 3 * s);
    }
    // stamina sliver while sprinting
    if (p.stamina < 0.99) {
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.fillRect(x, y + bh + (p.armor > 0 ? 10 : 6) * s, bw, 2 * s);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillRect(x, y + bh + (p.armor > 0 ? 10 : 6) * s, bw * p.stamina, 2 * s);
    }
    // money
    ctx.font = `600 ${26 * s}px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#e9f5d8';
    ctx.shadowColor = 'rgba(0,0,0,0.7)';
    ctx.shadowBlur = 5 * s;
    ctx.fillText('$' + p.money.toLocaleString('en-US'), x, y - 12 * s);
    ctx.restore();
  }

  drawWeapon(ctx, game, s) {
    const p = game.player;
    if (p.vehicle) {
      ctx.save();
      ctx.font = `500 ${11 * s}px ${FONT}`;
      ctx.fillStyle = 'rgba(255,255,255,0.62)';
      ctx.textAlign = 'right';
      ctx.fillText(p.vehicle.spec.name.toUpperCase(), this.w - 26 * s, this.h - 30 * s);
      ctx.restore();
      return;
    }
    const w = p.currentWeapon();
    const a = p.ammo[p.gun];
    const x = this.w - 30 * s, y = this.h - 34 * s;
    ctx.save();
    ctx.textAlign = 'right';
    ctx.font = `600 ${28 * s}px ${FONT}`;
    ctx.fillStyle = a.mag > 0 ? '#f4ead8' : '#e2523f';
    ctx.shadowColor = 'rgba(0,0,0,0.75)';
    ctx.shadowBlur = 6 * s;
    ctx.fillText(String(a.mag), x - 44 * s, y);
    ctx.font = `500 ${14 * s}px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText('/ ' + a.reserve, x, y);
    ctx.font = `600 ${11 * s}px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.fillText(w.name.toUpperCase(), x, y - 34 * s);
    if (p.reloadTimer > 0) {
      ctx.fillStyle = '#ffd166';
      ctx.fillText('RELOADING', x, y - 50 * s);
    }
    ctx.restore();
  }

  // ---- minimap -----------------------------------------------------------

  drawMinimap(ctx, game, s) {
    const size = 172 * s;
    const x = this.w - size - 24 * s;
    const y = 24 * s;
    const p = game.player;
    const px = p.vehicle ? p.vehicle.x : p.x;
    const pz = p.vehicle ? p.vehicle.z : p.z;
    const pyaw = p.vehicle ? p.vehicle.yaw : p.yaw;
    const range = 118; // metres across the minimap
    const k = size / range;

    ctx.save();
    // rounded frame
    ctx.beginPath();
    this.roundRect(ctx, x - 5 * s, y - 5 * s, size + 10 * s, size + 10 * s, 10 * s);
    ctx.fillStyle = 'rgba(8,12,18,0.72)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,214,166,0.24)';
    ctx.lineWidth = 1.4 * s;
    ctx.stroke();

    ctx.beginPath();
    this.roundRect(ctx, x, y, size, size, 7 * s);
    ctx.clip();

    // ground
    ctx.fillStyle = '#1d2b2e';
    ctx.fillRect(x, y, size, size);

    const toX = (wx) => x + size / 2 + (wx - px) * k;
    const toY = (wz) => y + size / 2 + (wz - pz) * k;

    // sea on the south and east
    ctx.fillStyle = '#123a45';
    const city = game.world.city;
    ctx.fillRect(x, toY(city.beachZ + 4), size, size);
    ctx.fillRect(toX(city.landHalf), y, size, size);

    // blocks
    for (const b of city.blocks) {
      const bx = toX(b.x - b.side / 2), by = toY(b.z - b.side / 2);
      const bw = b.side * k, bh = b.side * k;
      ctx.fillStyle = b.park ? '#27492c' : '#3a4048';
      ctx.fillRect(bx, by, bw, bh);
      if (!b.park && b.height > 20) {
        ctx.fillStyle = 'rgba(120,128,138,0.55)';
        ctx.fillRect(bx + bw * 0.16, by + bh * 0.16, bw * 0.68, bh * 0.68);
      }
    }
    // major avenue
    ctx.strokeStyle = 'rgba(226,206,168,0.20)';
    ctx.lineWidth = 2 * s;
    ctx.beginPath();
    const midLine = city.lines[3];
    ctx.moveTo(toX(midLine), y); ctx.lineTo(toX(midLine), y + size);
    ctx.moveTo(x, toY(midLine)); ctx.lineTo(x + size, toY(midLine));
    ctx.stroke();

    // mission marker
    const mk = game.missionMarker;
    if (mk) {
      const mx = toX(mk.x), my = toY(mk.z);
      const pulse = 0.6 + 0.4 * Math.sin(game.time * 4);
      ctx.beginPath();
      ctx.arc(mx, my, 7 * s, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,209,102,${0.28 * pulse})`;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(mx, my, 4 * s, 0, Math.PI * 2);
      ctx.fillStyle = '#ffd166';
      ctx.fill();
    }

    // police blips
    for (const u of game.police.units) {
      const ux = toX(u.car.x), uy = toY(u.car.z);
      const flash = Math.sin(game.time * 10) > 0;
      ctx.beginPath();
      ctx.arc(ux, uy, 3.6 * s, 0, Math.PI * 2);
      ctx.fillStyle = flash ? '#4a7dff' : '#ff4a3d';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 0.8 * s;
      ctx.stroke();
    }
    // traffic
    for (const v of game.vehicles) {
      if (v.dead || v.spec.police) continue;
      const d = Math.hypot(v.x - px, v.z - pz);
      if (d > range * 0.75) continue;
      ctx.fillStyle = 'rgba(200,205,210,0.42)';
      ctx.fillRect(toX(v.x) - 1.2 * s, toY(v.z) - 1.2 * s, 2.4 * s, 2.4 * s);
    }
    // pedestrians
    for (const ped of game.peds) {
      if (ped.dead) continue;
      const d = Math.hypot(ped.x - px, ped.z - pz);
      if (d > 60) continue;
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.fillRect(toX(ped.x) - 0.7 * s, toY(ped.z) - 0.7 * s, 1.4 * s, 1.4 * s);
    }

    // player wedge
    const cx = x + size / 2, cy = y + size / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-pyaw + Math.PI);
    ctx.beginPath();
    ctx.moveTo(0, -7.5 * s);
    ctx.lineTo(5.2 * s, 6.5 * s);
    ctx.lineTo(0, 3.6 * s);
    ctx.lineTo(-5.2 * s, 6.5 * s);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 3 * s;
    ctx.fill();
    ctx.restore();

    // north marker
    ctx.font = `600 ${11 * s}px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.textAlign = 'center';
    ctx.fillText('N', x + size - 13 * s, y + 16 * s);

    ctx.restore();

    // street name under the map
    const street = this.streetName(game, px, pz);
    ctx.save();
    ctx.font = `600 ${11 * s}px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,255,255,0.66)';
    ctx.fillText(street, x + size, y + size + 20 * s);
    ctx.restore();
  }

  streetName(game, x, z) {
    const city = game.world.city;
    const names = ['Albatross Ave', 'Cobalt Blvd', 'Marisol St', 'Petrel Way', 'Kestrel Row', 'Harbor Dr', 'Tide Ln', 'Gull St'];
    const pitch = CITY.pitch;
    const ix = Math.round((x + CITY.half) / pitch);
    const iz = Math.round((z + CITY.half) / pitch);
    const nearX = Math.abs(x - city.lines[clamp(ix, 0, city.lines.length - 1)]);
    const nearZ = Math.abs(z - city.lines[clamp(iz, 0, city.lines.length - 1)]);
    if (Math.min(nearX, nearZ) > 12) return game.districtName(x, z);
    const idx = nearX < nearZ ? ix : iz;
    return names[((idx % names.length) + names.length) % names.length];
  }

  drawBigMap(ctx, game) {
    const w = this.w, h = this.h;
    ctx.save();
    ctx.fillStyle = 'rgba(6,9,13,0.88)';
    ctx.fillRect(0, 0, w, h);
    const size = Math.min(w, h) * 0.78;
    const x = (w - size) / 2, y = (h - size) / 2;
    const city = game.world.city;
    const p = game.player;
    const px = p.vehicle ? p.vehicle.x : p.x;
    const pz = p.vehicle ? p.vehicle.z : p.z;
    const span = 780;
    const k = size / span;
    const toX = (wx) => x + size / 2 + (wx - px) * k;
    const toY = (wz) => y + size / 2 + (wz - pz) * k;
    ctx.beginPath();
    this.roundRect(ctx, x, y, size, size, 14);
    ctx.clip();
    ctx.fillStyle = '#16232a';
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = '#123a45';
    ctx.fillRect(x, toY(city.beachZ + 4), size, size);
    ctx.fillRect(toX(city.landHalf), y, size, size);
    for (const b of city.blocks) {
      ctx.fillStyle = b.park ? '#27492c' : '#39404a';
      ctx.fillRect(toX(b.x - b.side / 2), toY(b.z - b.side / 2), b.side * k, b.side * k);
    }
    // district labels
    const labels = [
      ['COBALT HEIGHTS', 0, -40], ['LANTERN ROW', -110, 90], ['PIER NINE', 240, -210],
      ['SOLANA STRIP', 40, 210], ['FERRO YARDS', -210, -200],
    ];
    ctx.font = `700 ${13 * k * 34}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,235,210,0.34)';
    for (const [t, ox, oz] of labels) ctx.fillText(t, toX(ox), toY(oz));
    // landmarks
    for (const [key, pos] of Object.entries(city.landmarks)) {
      ctx.beginPath();
      ctx.arc(toX(pos[0]), toY(pos[1]), 5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,209,102,0.8)';
      ctx.fill();
      ctx.font = `600 ${11}px ${FONT}`;
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText(key.toUpperCase(), toX(pos[0]), toY(pos[1]) - 9);
    }
    if (game.missionMarker) {
      const mk = game.missionMarker;
      ctx.beginPath();
      ctx.arc(toX(mk.x), toY(mk.z), 8, 0, Math.PI * 2);
      ctx.fillStyle = '#ffd166';
      ctx.fill();
    }
    ctx.save();
    ctx.translate(toX(px), toY(pz));
    ctx.rotate(-(p.vehicle ? p.vehicle.yaw : p.yaw) + Math.PI);
    ctx.beginPath();
    ctx.moveTo(0, -10); ctx.lineTo(7, 8); ctx.lineTo(0, 4); ctx.lineTo(-7, 8);
    ctx.closePath();
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.restore();
    ctx.restore();
    ctx.save();
    ctx.font = `500 12px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText('M  CLOSE MAP', w / 2, y + size + 26);
    ctx.restore();
  }

  drawObjective(ctx, game, s) {
    if (!this.objText) return;
    const x = this.w - 26 * s;
    const y = 24 * s + 172 * s + 52 * s;
    ctx.save();
    ctx.textAlign = 'right';
    ctx.font = `600 ${11 * s}px ${FONT}`;
    ctx.fillStyle = 'rgba(255,209,102,0.85)';
    ctx.fillText(this.objSub || 'OBJECTIVE', x, y);
    ctx.font = `500 ${15 * s}px ${FONT}`;
    ctx.fillStyle = '#f2e8d8';
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 6 * s;
    const lines = this.wrap(ctx, this.objText, 300 * s);
    lines.slice(0, 3).forEach((ln, i) => ctx.fillText(ln, x, y + (20 + i * 19) * s));
    ctx.restore();
  }

  drawSpeed(ctx, game, s) {
    const p = game.player;
    if (!p.vehicle) return;
    const v = p.vehicle;
    const kmh = Math.abs(v.forwardSpeed) * 3.6;
    const cx = this.w - 96 * s;
    const y = this.h - 74 * s;
    ctx.save();
    ctx.textAlign = 'right';
    ctx.font = `700 ${44 * s}px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 8 * s;
    ctx.fillText(String(Math.round(kmh)), cx, y);
    ctx.font = `600 ${10 * s}px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillText('KM/H', cx, y + 14 * s);
    // gear
    const gear = v.forwardSpeed < -0.5 ? 'R' : Math.min(6, Math.floor(Math.abs(v.forwardSpeed) / (v.spec.top / 5.6)) + 1);
    ctx.font = `600 ${13 * s}px ${FONT}`;
    ctx.fillStyle = 'rgba(255,209,102,0.9)';
    ctx.fillText('GEAR ' + gear, cx, y - 44 * s);
    // rev bar
    const rev = clamp(Math.abs(v.forwardSpeed) / v.spec.top, 0, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fillRect(cx - 120 * s, y + 22 * s, 120 * s, 3 * s);
    ctx.fillStyle = rev > 0.85 ? '#ff6b52' : 'rgba(255,209,102,0.8)';
    ctx.fillRect(cx - 120 * s, y + 22 * s, 120 * s * rev, 3 * s);
    // damage
    if (v.health < 60) {
      ctx.font = `600 ${10 * s}px ${FONT}`;
      ctx.fillStyle = `rgba(255,90,70,${0.5 + 0.5 * Math.sin(game.time * 7)})`;
      ctx.fillText('ENGINE DAMAGE', cx, y - 58 * s);
    }
    ctx.restore();
  }

  drawCrosshair(ctx, game, s) {
    const p = game.player;
    if (p.vehicle || p.dead) return;
    const cx = this.w / 2, cy = this.h / 2;
    const spread = 6 + (p.aiming ? 2 : 9) + game.combat.recoil * 10;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.78)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      ctx.moveTo(cx + dx * spread, cy + dy * spread);
      ctx.lineTo(cx + dx * (spread + 7), cy + dy * (spread + 7));
    }
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 1.4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fill();
    if (this.hitFlash > 0) {
      ctx.strokeStyle = `rgba(255,80,60,${this.hitFlash * 5})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (const [dx, dy] of [[1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        ctx.moveTo(cx + dx * 8, cy + dy * 8);
        ctx.lineTo(cx + dx * 15, cy + dy * 15);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  drawToasts(ctx, s) {
    const cx = this.w / 2;
    let y = 96 * s;
    ctx.save();
    ctx.textAlign = 'center';
    for (const t of this.toasts) {
      const a = clamp(t.life / 0.6, 0, 1) * clamp((t.max - t.life) / 0.18, 0, 1);
      const col = t.kind === 'warn' ? '255,120,90' : t.kind === 'good' ? '130,220,150' : '240,232,214';
      ctx.font = `600 ${14 * s}px ${FONT}`;
      const wpx = ctx.measureText(t.text).width;
      ctx.fillStyle = `rgba(8,11,16,${0.55 * a})`;
      this.roundRect(ctx, cx - wpx / 2 - 14 * s, y - 15 * s, wpx + 28 * s, 24 * s, 4 * s);
      ctx.fill();
      ctx.fillStyle = `rgba(${col},${a})`;
      ctx.fillText(t.text, cx, y);
      y += 30 * s;
    }
    ctx.restore();
  }

  drawHint(ctx, s) {
    if (!this.hint) return;
    const a = clamp(this.hintTimer / 0.5, 0, 1);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = `500 ${15 * s}px ${FONT}`;
    const cx = this.w / 2, cy = this.h * 0.68;
    const wpx = ctx.measureText(this.hint).width;
    ctx.fillStyle = `rgba(8,11,16,${0.62 * a})`;
    this.roundRect(ctx, cx - wpx / 2 - 16 * s, cy - 19 * s, wpx + 32 * s, 32 * s, 5 * s);
    ctx.fill();
    ctx.fillStyle = `rgba(255,238,214,${a})`;
    ctx.fillText(this.hint, cx, cy + 2 * s);
    ctx.restore();
  }

  showHint(text, time = 2.4) { this.hint = text; this.hintTimer = time; }

  drawClock(ctx, game, s) {
    const w = this.w;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = `500 ${11 * s}px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.42)';
    ctx.fillText(game.world.fmtClock(), w - 24 * s - 86 * s, 24 * s + 172 * s + 34 * s);
    ctx.restore();
  }

  wrap(ctx, text, max) {
    const words = text.split(' ');
    const lines = [];
    let line = '';
    for (const word of words) {
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width > max && line) { lines.push(line); line = word; }
      else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }

  roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
