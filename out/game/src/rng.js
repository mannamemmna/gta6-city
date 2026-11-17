// A tiny deterministic generator (mulberry32). The whole city is a pure function of its seed,
// which is what lets the screenshot staging rebuild the exact same streets every run.

export function createRandom(seed) {
  let state = seed >>> 0;
  function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return {
    next,
    range: (lo, hi) => lo + next() * (hi - lo),
    int: (lo, hi) => Math.floor(lo + next() * (hi - lo + 1)),
    pick: (list) => list[Math.floor(next() * list.length) % list.length],
    chance: (p) => next() < p,
    sign: () => (next() < 0.5 ? -1 : 1),
  };
}

/** Picks a random point on a road, away from the map edge: used to spawn traffic and police. */
export function randomRoadPoint(rng, city) {
  const alongX = rng.chance(0.5);
  const lineIndex = rng.int(0, alongX ? city.roadZ.length - 1 : city.roadX.length - 1);
  const t = rng.range(-0.86, 0.86);
  if (alongX) {
    return { x: t * city.maxX * 0.92, z: city.roadZ[lineIndex], heading: t > 0 ? Math.PI : 0 };
  }
  return { x: city.roadX[lineIndex], z: t * city.maxZ * 0.92, heading: t > 0 ? -Math.PI / 2 : Math.PI / 2 };
}
