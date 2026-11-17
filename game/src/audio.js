// Sound, synthesised at runtime with WebAudio — no audio files, so the game still loads with no
// network and nothing to vendor. Each cue is a short envelope over an oscillator or a filtered
// noise burst: gunshots, a car engine that tracks speed, a police siren, the horn, cash and UI
// blips, and the low ambient wash of the city. Muted until the first click, as browsers require.
export class AudioSystem {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.engine = null;
    this.sirenOsc = null;
    this.enabled = true;
    this.engineGain = null;
    this.sirenGain = null;
    this.noiseBuffer = null;
    this.lastPlay = new Map();
  }

  /** Must be called from a user gesture (a click) to satisfy autoplay policy. */
  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) { this.enabled = false; return; }
    const ctx = new Ctx();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
    this.master = master;

    // shared noise buffer for gunshots, tyres and surf
    const len = Math.floor(ctx.sampleRate * 0.6);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
    this.noiseBuffer = buf;

    // engine: two detuned saws through a lowpass, gain tied to speed
    const engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 780;
    lp.Q.value = 3.2;
    engineGain.connect(lp).connect(master);
    const oscA = ctx.createOscillator();
    oscA.type = 'sawtooth';
    oscA.frequency.value = 62;
    const oscB = ctx.createOscillator();
    oscB.type = 'square';
    oscB.frequency.value = 31;
    oscA.connect(engineGain);
    oscB.connect(engineGain);
    oscA.start();
    oscB.start();
    this.engine = { oscA, oscB, lp, gain: engineGain };

    // siren: one oscillator, gain faded in only while wanted
    const sirenGain = ctx.createGain();
    sirenGain.gain.value = 0;
    sirenGain.connect(master);
    const sirenOsc = ctx.createOscillator();
    sirenOsc.type = 'triangle';
    sirenOsc.frequency.value = 780;
    sirenOsc.connect(sirenGain);
    sirenOsc.start();
    this.siren = { osc: sirenOsc, gain: sirenGain, phase: 0 };

    // ambient city wash: filtered noise, very quiet
    const amb = ctx.createBufferSource();
    amb.buffer = buf;
    amb.loop = true;
    const ambFilter = ctx.createBiquadFilter();
    ambFilter.type = 'bandpass';
    ambFilter.frequency.value = 420;
    ambFilter.Q.value = 0.7;
    const ambGain = ctx.createGain();
    ambGain.gain.value = 0.045;
    amb.connect(ambFilter).connect(ambGain).connect(master);
    amb.start();

    this.startSurf();
  }

  startSurf() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.value = 0.0;
    src.connect(f).connect(g).connect(this.master);
    src.start();
    this.surf = { gain: g };
    // slow swell
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.14;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.02;
    lfo.connect(lfoGain).connect(g.gain);
    lfo.start();
  }

  /** A one-shot cue, rate-limited per name so a burst of shots does not clip. */
  play(name, volume = 1) {
    if (!this.ctx || !this.enabled) return;
    const now = this.ctx.currentTime;
    const last = this.lastPlay.get(name) ?? -1;
    if (now - last < 0.035) return;
    this.lastPlay.set(name, now);
    switch (name) {
      case 'shot': this.noiseBurst(0.11, 1400, 0.5 * volume, 'square'); this.tone(160, 60, 0.1, 0.22 * volume, 'sawtooth'); break;
      case 'enemyShot': this.noiseBurst(0.09, 900, 0.3 * volume, 'square'); break;
      case 'hit': this.tone(220, 90, 0.12, 0.2 * volume, 'triangle'); break;
      case 'cash': this.tone(880, 1320, 0.12, 0.18, 'sine'); setTimeout(() => this.tone(1320, 1760, 0.1, 0.13, 'sine'), 70); break;
      case 'mission': this.tone(392, 523, 0.4, 0.16, 'triangle'); setTimeout(() => this.tone(523, 659, 0.5, 0.14, 'triangle'), 180); break;
      case 'objective': this.tone(660, 990, 0.16, 0.12, 'sine'); break;
      case 'complete': [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, f, 0.5, 0.14, 'triangle'), i * 130)); break;
      case 'fail': this.tone(330, 110, 0.7, 0.2, 'sawtooth'); break;
      case 'evade': this.tone(300, 200, 0.4, 0.12, 'sine'); break;
      case 'horn': this.tone(330, 330, 0.32, 0.16, 'square'); this.tone(415, 415, 0.32, 0.1, 'square'); break;
      case 'door': this.noiseBurst(0.16, 500, 0.35, 'lowpass'); break;
      case 'step': this.noiseBurst(0.05, 340, 0.1); break;
      case 'bell': this.tone(1046, 1046, 0.6, 0.1, 'sine'); break;
      default: break;
    }
  }

  tone(from, to, dur, vol, type = 'sine') {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  noiseBurst(dur, cutoff, vol, type = 'lowpass') {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  /** Called every frame: engine note and siren follow the game state. */
  update(dt, { speed = 0, inCar = false, wanted = 0, nearPolice = false } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const e = this.engine;
    const targetGain = inCar ? 0.05 + Math.min(0.1, Math.abs(speed) * 0.004) : 0;
    e.gain.gain.setTargetAtTime(targetGain, t, 0.12);
    const rpm = 52 + Math.abs(speed) * 5.2 + (inCar ? 18 : 0);
    e.oscA.frequency.setTargetAtTime(rpm, t, 0.14);
    e.oscB.frequency.setTargetAtTime(rpm * 0.5, t, 0.14);
    e.lp.frequency.setTargetAtTime(560 + Math.abs(speed) * 34, t, 0.2);

    const sirenOn = wanted > 0 && nearPolice;
    this.siren.gain.gain.setTargetAtTime(sirenOn ? 0.055 : 0, t, 0.25);
    if (sirenOn) {
      this.siren.phase += dt * 0.7;
      const wail = 640 + Math.sin(this.siren.phase * Math.PI * 2) * 260;
      this.siren.osc.frequency.setTargetAtTime(wail, t, 0.05);
    }
    if (this.surf) this.surf.gain.gain.setTargetAtTime(0.014, t, 1.5);
  }
}
