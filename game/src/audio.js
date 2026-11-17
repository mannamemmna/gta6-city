// All sound is synthesised: no files, no network. A small mixer with a noise
// generator, a filtered saw for engines and sirens, and one-shot voices for guns,
// impacts, horns and the stingers that play under mission cards.

export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.master = null;
    this.engineNode = null;
    this.sirenNode = null;
    this.sirenGain = null;
    this.musicGain = null;
    this.muted = false;
  }

  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);

    // shared noise buffer
    const len = this.ctx.sampleRate * 1.2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.0;
    this.musicGain.connect(this.master);
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  noiseBurst(dur, freq, gain, type = 'lowpass', q = 1) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 1 + Math.random() * 0.3;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur + 0.02);
  }

  tone(freq, dur, gain, type = 'sine', slideTo = null, delay = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.03);
  }

  gunshot(kind) {
    if (!this.ctx) return;
    if (kind === 'shotgun') {
      this.noiseBurst(0.30, 1400, 0.5, 'lowpass');
      this.tone(90, 0.22, 0.28, 'sine', 40);
    } else if (kind === 'smg') {
      this.noiseBurst(0.10, 2600, 0.26, 'bandpass', 0.8);
      this.tone(180, 0.06, 0.12, 'square', 90);
    } else {
      this.noiseBurst(0.16, 2100, 0.34, 'bandpass', 0.7);
      this.tone(150, 0.09, 0.16, 'square', 70);
    }
  }

  distantShot(dist) {
    const g = Math.max(0.02, 0.2 - dist * 0.0018);
    this.noiseBurst(0.2, 900, g, 'lowpass');
  }

  impact() { this.noiseBurst(0.12, 420, 0.28, 'lowpass'); this.tone(70, 0.1, 0.16, 'sine', 40); }
  punch() { this.noiseBurst(0.09, 300, 0.3, 'lowpass'); }
  playerHit() { this.tone(120, 0.16, 0.14, 'triangle', 60); this.noiseBurst(0.1, 500, 0.16); }
  horn() { this.tone(392, 0.34, 0.12, 'square'); this.tone(311, 0.34, 0.10, 'square'); }
  doorOpen() { this.noiseBurst(0.14, 800, 0.14, 'bandpass', 1.4); }
  pickup() { this.tone(660, 0.09, 0.16, 'triangle'); this.tone(990, 0.13, 0.13, 'triangle', null, 0.07); }
  cash() { this.tone(880, 0.08, 0.14, 'sine'); this.tone(1320, 0.14, 0.1, 'sine', null, 0.06); }
  fail() { this.tone(220, 0.24, 0.16, 'sawtooth', 110); this.tone(150, 0.4, 0.12, 'sawtooth', 70, 0.16); }
  success() {
    const notes = [523, 659, 784, 1046];
    notes.forEach((n, i) => this.tone(n, 0.22, 0.12, 'triangle', null, i * 0.09));
  }
  sirenBlip() {
    if (!this.ctx) return;
    this.tone(760, 0.22, 0.10, 'sawtooth', 540);
    this.tone(560, 0.22, 0.08, 'sawtooth', 760, 0.22);
  }
  explosion() {
    this.noiseBurst(0.9, 320, 0.55, 'lowpass');
    this.noiseBurst(0.5, 1600, 0.3, 'bandpass', 0.5);
    this.tone(56, 0.7, 0.32, 'sine', 24);
  }

  // continuous voices: engine and siren, driven each frame
  attachEngine() {
    if (!this.ctx || this.engineNode) return;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = 60;
    const o2 = this.ctx.createOscillator();
    o2.type = 'square';
    o2.frequency.value = 30;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 620; f.Q.value = 3;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    o.connect(f); o2.connect(f); f.connect(g); g.connect(this.master);
    o.start(); o2.start();
    this.engineNode = { o, o2, f, g };
  }

  engine(speedNorm, throttle) {
    if (!this.engineNode) return;
    const t = this.ctx.currentTime;
    const e = this.engineNode;
    const freq = 48 + speedNorm * 190;
    e.o.frequency.setTargetAtTime(freq, t, 0.09);
    e.o2.frequency.setTargetAtTime(freq * 0.5, t, 0.09);
    e.f.frequency.setTargetAtTime(420 + speedNorm * 1400 + throttle * 380, t, 0.1);
    e.g.gain.setTargetAtTime(0.055 + throttle * 0.055 + speedNorm * 0.04, t, 0.1);
  }
  engineOff() {
    if (!this.engineNode) return;
    this.engineNode.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.12);
  }

  attachSiren() {
    if (!this.ctx || this.sirenNode) return;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = 700;
    const lfo = this.ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.42;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 250;
    lfo.connect(lfoGain); lfoGain.connect(o.frequency);
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.8;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    o.connect(f); f.connect(g); g.connect(this.master);
    o.start(); lfo.start();
    this.sirenNode = o; this.sirenGain = g;
  }
  siren(level) {
    if (!this.sirenGain) return;
    this.sirenGain.gain.setTargetAtTime(level > 0 ? 0.035 + level * 0.012 : 0, this.ctx.currentTime, 0.3);
  }

  // mission card stinger: a low two-note swell
  stinger() {
    this.tone(110, 0.9, 0.16, 'triangle', 82);
    this.tone(165, 0.9, 0.10, 'triangle', 123, 0.08);
    this.noiseBurst(0.6, 700, 0.06, 'bandpass', 0.6);
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }
}
