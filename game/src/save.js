// Saving: one slot in localStorage, versioned, with everything that matters —
// where you are, what you carry, what you've done, and how much of the bay is yours.

const KEY = 'cobaltbay.save.v1';

export function saveGame(game) {
  const p = game.player;
  const data = {
    v: 1,
    at: Date.now(),
    player: p.serialize(),
    mission: game.missions.serialize(),
    property: game.property,
    rep: game.rep,
    time: game.world.time,
    clock: game.world.clock,
    kills: game.combat.kills,
    carsStolen: game.stats.carsStolen,
    peds: game.stats.peds,
    districts: game.visitedDistricts ? [...game.visitedDistricts] : [],
    vehicle: p.vehicle ? { id: p.vehicle.spec.id, x: p.vehicle.x, z: p.vehicle.z, yaw: p.vehicle.yaw } : null,
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    return false;
  }
}

export function loadGame(game) {
  let raw;
  try { raw = localStorage.getItem(KEY); } catch (e) { return false; }
  if (!raw) return false;
  let data;
  try { data = JSON.parse(raw); } catch (e) { return false; }
  if (!data || data.v !== 1) return false;
  game.player.restore(data.player);
  game.player.money = data.player.money ?? 250;
  game.missions.restore(data.mission);
  game.property = data.property ?? {};
  game.rep = data.rep ?? 0;
  game.stats.carsStolen = data.carsStolen ?? 0;
  game.stats.peds = data.peds ?? 0;
  game.visitedDistricts = new Set(data.districts ?? []);
  game.world.time = data.time ?? 0;
  game.world.clock = data.clock ?? 12;
  if (data.vehicle) {
    const car = game.vehicles.find((v) => v.spec.id === data.vehicle.id && Math.hypot(v.x - data.vehicle.x, v.z - data.vehicle.z) < 40)
      ?? game.nearestVehicle(data.vehicle.x, data.vehicle.z);
    if (car) game.enterVehicle(car, true);
  }
  return true;
}

export function hasSave() {
  try { return !!localStorage.getItem(KEY); } catch (e) { return false; }
}

export function clearSave() {
  try { localStorage.removeItem(KEY); } catch (e) {}
}

export function saveSummary() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    return { money: d.player?.money ?? 0, missions: d.mission?.completed?.length ?? 0, at: d.at };
  } catch (e) { return null; }
}
