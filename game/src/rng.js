// Deterministic random numbers. The city, the traffic and every staged screenshot
// read from here so a given seed always rebuilds the same Cobalt Bay.

export function makeRng(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  return function next() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function range(rng, lo, hi) {
  return lo + (hi - lo) * rng();
}

export function intRange(rng, lo, hi) {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

export function pick(rng, arr) {
  return arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];
}

export function chance(rng, p) {
  return rng() < p;
}

// Stable per-cell random: the same block always gets the same jitter no matter
// what order the generator visits the grid in.
export function cellRng(seed, ix, iz) {
  let h = (seed ^ 0x27d4eb2d) >>> 0;
  h = Math.imul(h ^ (ix + 0x7ed55d16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (iz + 0xc761c23c), 0xc2b2ae35) >>> 0;
  h ^= h >>> 13;
  return makeRng(h);
}

// Cheap value noise for district falloff and facade variation.
export function noise2(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const h = (a, b) => {
    let n = Math.imul(a * 374761393 + b * 668265263, 1274126177);
    n = (n ^ (n >>> 13)) >>> 0;
    return n / 4294967296;
  };
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);
  const a = h(xi, zi), b = h(xi + 1, zi), c = h(xi, zi + 1), d = h(xi + 1, zi + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}
