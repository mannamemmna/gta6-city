// Instance writer. Every frame the world hands this a pile of primitives and it
// flushes them to the renderer in one call per geometry, so the draw count stays
// flat however busy the street gets.

const STRIDE = 11;

export class InstanceBuffer {
  constructor(capacity = 2048) {
    this.data = new Float32Array(capacity * STRIDE);
    this.count = 0;
    this.capacity = capacity;
  }
  reset() { this.count = 0; }
  _grow(need) {
    const cap = Math.max(this.capacity * 2, need);
    const d = new Float32Array(cap * STRIDE);
    d.set(this.data.subarray(0, this.count * STRIDE));
    this.data = d;
    this.capacity = cap;
  }
  push(x, y, z, sx, sy, sz, rot, col, mat = 0) {
    if (this.count + 1 > this.capacity) this._grow(this.count + 1);
    const o = this.count * STRIDE;
    const d = this.data;
    d[o] = x; d[o + 1] = y; d[o + 2] = z;
    d[o + 3] = sx; d[o + 4] = sy; d[o + 5] = sz;
    d[o + 6] = rot;
    d[o + 7] = col[0]; d[o + 8] = col[1]; d[o + 9] = col[2];
    d[o + 10] = mat;
    this.count++;
    return this;
  }
  // A box sitting on a surface, rotated about Y.
  box(x, y, z, w, h, d, col, rot = 0, mat = 0) {
    return this.push(x, y, z, w, h, d, rot, col, mat);
  }
  // A box given by its centre height, easier for vehicle bodies.
  boxMid(cx, cy, cz, w, h, d, col, rot = 0, mat = 0) {
    return this.push(cx, cy - h / 2, cz, w, h, d, rot, col, mat);
  }
  cyl(x, y, z, r, h, col, mat = 0) {
    return this.push(x, y, z, r * 2, h, r * 2, 0, col, mat);
  }
  wheelX(x, y, z, radius, width, col, rot = 0) {
    return this.push(x, y - radius, z, width, radius * 2, radius * 2, rot, col, 0);
  }
  ball(x, y, z, r, col, squash = 1, mat = 3) {
    return this.push(x, y - r * squash, z, r * 2, r * 2 * squash, r * 2, 0, col, mat);
  }
  // Point a local offset through a Y-rotation and add it.
  local(ox, oz, rot) {
    const c = Math.cos(rot), s = Math.sin(rot);
    return [ox * c - oz * s, ox * s + oz * c];
  }
  groups(out = []) {
    out.length = 0;
    out.push({ geometry: 'box', data: this.data, count: this.count });
    return out;
  }
}

// Three per-geometry buffers, flushed together, with one shared capacity policy.
export class SceneBuffers {
  constructor(cap = 4096) {
    this.box = new InstanceBuffer(cap);
    this.cyl = new InstanceBuffer(512);
    this.cylx = new InstanceBuffer(256);
    this.ball = new InstanceBuffer(512);
  }
  reset() {
    this.box.reset(); this.cyl.reset(); this.cylx.reset(); this.ball.reset();
  }
  // SceneBuffers can stand in for the box buffer anywhere a caller just wants
  // plain primitives (characters, vehicles, decals).
  push(...args) { return this.box.push(...args); }
  boxAt(...args) { return this.box.box(...args); }
  cylAt(...args) { return this.cyl.cyl(...args); }
  wheelX(...args) { return this.cylx.wheelX(...args); }
  ballAt(...args) { return this.ball.ball(...args); }
  groups() {
    return [
      { geometry: 'box', data: this.box.data, count: this.box.count },
      { geometry: 'cyl', data: this.cyl.data, count: this.cyl.count },
      { geometry: 'cylx', data: this.cylx.data, count: this.cylx.count },
      { geometry: 'ball', data: this.ball.data, count: this.ball.count },
    ];
  }
}
