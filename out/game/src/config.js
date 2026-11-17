// Every tuning number and colour the game uses. The city is a grid of blocks separated by
// roads, with the sea to the south: all world positions are metres, +X east, +Z south, +Y up.

export const STEP = 1 / 60;

export const CITY = {
  pitch: 76,        // centre-to-centre distance between road lines
  blocksX: 8,       // blocks along X
  blocksZ: 5,       // blocks along Z
  road: 20,         // asphalt width
  block: 48,        // built width of a block, sidewalk included
  sidewalk: 3.4,    // sidewalk band around each block
  beachZ: 204,      // where the promenade ends and the sand starts
  waterZ: 238,      // waterline
  // Derived extents; city.js fills the same values in for the rest of the game.
  minX: -8 / 2 * 76 - 10,
  maxX: 8 / 2 * 76 + 10,
  minZ: -5 / 2 * 76 - 10,
  maxZ: 5 / 2 * 76 + 10,
};

export const SUN = {
  azimuth: -0.85,
  elevation: 0.30,
  color: 0xffd9a0,
  intensity: 2.35,
};

export const PALETTE = {
  asphalt: 0x4a4a52,
  laneWhite: 0xe8e4d8,
  laneYellow: 0xe8c65a,
  sidewalk: 0xc9bda9,
  sidewalkDark: 0xa89880,
  kerb: 0xb6a992,
  sand: 0xe4cd9e,
  grass: 0x6f8f4a,
  palmTrunk: 0x8a6a48,
  palmLeaf: 0x4e7a3a,
  water: 0x1f6f92,
  metal: 0x9aa0a6,
  glass: 0x2b4552,
  neonPink: 0xff5f9e,
  neonCyan: 0x54e8ff,
  neonAmber: 0xffb03a,
};

// Times of day the game can be put in (the screenshot staging uses these too).
export const TIME_OF_DAY = {
  noon: { sun: 0xfff2d8, intensity: 2.9, sky: 0x3f86c8, horizon: 0xd8ecff, ambient: 1.25, fog: 0xcfe3f0, elev: 1.15 },
  golden: { sun: 0xffc478, intensity: 2.5, sky: 0x3462a0, horizon: 0xffc38a, ambient: 0.95, fog: 0xf0bd92, elev: 0.28 },
  dusk: { sun: 0xff9a5c, intensity: 1.5, sky: 0x24325e, horizon: 0xff8a5e, ambient: 0.62, fog: 0xcf8f74, elev: 0.10 },
};

export const PLAYER = {
  radius: 0.42,
  height: 1.8,
  walkSpeed: 3.6,
  runSpeed: 7.4,
  sprintSpeed: 9.6,
  jumpSpeed: 5.4,
  gravity: -19,
  health: 100,
  weaponRange: 70,
  fireRate: 0.16,
};

export const VEHICLE = {
  maxSpeed: 34,        // m/s ~ 122 km/h
  reverseSpeed: 9,
  accel: 14,
  brake: 26,
  drag: 0.5,
  steerRate: 1.6,
  radius: 1.3,
};

export const WANTED = {
  decaySeconds: 9,     // per star, when out of sight of police
};

export const SAVE_KEY = 'marisol-heat-save-v1';
