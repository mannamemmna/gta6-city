// Tunables and art direction for Cobalt Bay. Every number that shapes the feel
// of the game lives here so the rest of the modules stay about behaviour.

export const CITY_SEED = 20261117;

export const CITY = {
  blocks: 7,
  block: 62,
  road: 15,
  curb: 0.22,
  get pitch() { return this.block + this.road; },
  get half() { return (this.blocks * this.pitch) / 2; },
  mapHalf: 620,
};

export const SUN = {
  dir: [-0.52, 0.62, -0.58],
  color: [1.0, 0.93, 0.79],
};

export const SKY = {
  top: [0.20, 0.42, 0.74],
  horizon: [0.97, 0.78, 0.60],
  haze: [0.85, 0.77, 0.68],
  fogEnd: 640,
};

export const PLAYER = {
  height: 1.8,
  radius: 0.42,
  walk: 4.8,
  run: 8.4,
  swim: 3.2,
  jump: 6.6,
  gravity: 22,
  health: 100,
  aimSensitivity: 0.0026,
};

export const WEAPONS = {
  pistol:  { name: 'Tidewater 9',  dmg: 27, rpm: 340, spread: 0.012, mag: 12, reserve: 120, range: 190, auto: false },
  smg:     { name: 'Sable SMG',    dmg: 16, rpm: 780, spread: 0.031, mag: 30, reserve: 300, range: 150, auto: true },
  shotgun: { name: 'Breaker 12',   dmg: 72, rpm: 80,  spread: 0.078, mag: 6,  reserve: 48,  range: 48,  auto: false },
};

// Original cars: id, display name, paint, and the numbers the physics reads.
export const VEHICLES = [
  { id: 'marisol',   name: 'Marisol GT',     body: [0.78, 0.26, 0.22], len: 4.5, wid: 1.92, hgt: 1.34, top: 54, accel: 11.5, grip: 1.00, wt: 1.00, kind: 'coupe' },
  { id: 'tern',      name: 'Tern 1.4',       body: [0.70, 0.75, 0.80], len: 3.9, wid: 1.78, hgt: 1.48, top: 40, accel: 8.4,  grip: 1.02, wt: 0.92, kind: 'hatch' },
  { id: 'cormorant', name: 'Cormorant',      body: [0.10, 0.20, 0.29], len: 4.9, wid: 1.98, hgt: 1.30, top: 62, accel: 12.8, grip: 1.06, wt: 1.02, kind: 'coupe' },
  { id: 'barracuda', name: 'Barracuda 440',  body: [0.86, 0.68, 0.20], len: 5.1, wid: 2.02, hgt: 1.28, top: 60, accel: 14.6, grip: 0.94, wt: 1.10, kind: 'muscle' },
  { id: 'pelican',   name: 'Pelican Van',    body: [0.90, 0.90, 0.86], len: 5.6, wid: 2.10, hgt: 2.28, top: 34, accel: 6.6,  grip: 0.90, wt: 1.30, kind: 'van' },
  { id: 'manatee',   name: 'Manatee Hauler', body: [0.32, 0.37, 0.35], len: 6.6, wid: 2.30, hgt: 2.62, top: 30, accel: 5.8,  grip: 0.86, wt: 1.55, kind: 'truck' },
  { id: 'skua',      name: 'Skua RS',        body: [0.16, 0.54, 0.46], len: 4.3, wid: 1.90, hgt: 1.20, top: 66, accel: 15.8, grip: 1.10, wt: 0.96, kind: 'sport' },
  { id: 'petrel',    name: 'Petrel Cab',     body: [0.94, 0.80, 0.14], len: 4.7, wid: 1.94, hgt: 1.42, top: 46, accel: 9.2,  grip: 0.98, wt: 1.02, kind: 'sedan' },
  { id: 'osprey',    name: 'Osprey Pickup',  body: [0.42, 0.52, 0.32], len: 5.4, wid: 2.06, hgt: 1.86, top: 44, accel: 9.6,  grip: 0.93, wt: 1.18, kind: 'pickup' },
];

export const COP = {
  name: 'Cobalt Bay PD',
  car: { id: 'warden', name: 'Warden Interceptor', body: [0.93, 0.94, 0.95], len: 5.0, wid: 2.00, hgt: 1.50, top: 58, accel: 13.6, grip: 1.05, wt: 1.08, kind: 'sedan', police: true },
  levels: [
    { units: 1, shoot: 0.30, speed: 0.82 },
    { units: 2, shoot: 0.55, speed: 0.90 },
    { units: 2, shoot: 0.85, speed: 1.00 },
    { units: 3, shoot: 1.10, speed: 1.05 },
    { units: 4, shoot: 1.35, speed: 1.10 },
  ],
};

export const PEDS = {
  count: 120,
  radius: 0.34,
  walk: 1.35,
  run: 4.4,
  shirts: [0xe8ded0, 0x3f8fa8, 0xd6553f, 0xf0c464, 0x2f3b47, 0x8fa86b, 0xe6a7b8, 0x9a6bd8, 0xf4f4f0, 0x2ab0a0],
  pants:  [0x2b3540, 0x43525f, 0xb8a58a, 0x1e242b, 0x5a4636, 0x8c9aa5],
  skin:   [0xe7bd9a, 0xc48f63, 0x8d5c3c, 0x5c3b24, 0xf2d3b6, 0xa9714b],
  hair:   [0x241a14, 0x3d2a1c, 0x0f0c0a, 0x7a5236, 0xc9b28c, 0x22262b],
};

export const DISTRICTS = [
  { id: 'heights', name: 'Cobalt Heights', tint: [0.70, 0.73, 0.79], tall: [36, 98], mid: [16, 34] },
  { id: 'lantern', name: 'Lantern Row',    tint: [0.84, 0.70, 0.55], tall: [18, 46], mid: [10, 18] },
  { id: 'pier',    name: 'Pier Nine',      tint: [0.56, 0.59, 0.55], tall: [8, 18],  mid: [6, 12] },
  { id: 'solana',  name: 'Solana Strip',   tint: [0.92, 0.83, 0.68], tall: [10, 30], mid: [6, 14] },
  { id: 'ferro',   name: 'Ferro Yards',    tint: [0.54, 0.49, 0.45], tall: [10, 26], mid: [7, 14] },
];

export const MONEY = { start: 250, hospitalBill: 200 };

export const CLOCK = { startHour: 17.2, secondsPerHour: 40 };
