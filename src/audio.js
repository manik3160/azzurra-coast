/**
 * All game sound, synthesised with the Web Audio API.
 *
 * There are no audio files: Poki forbids external requests and weighs initial
 * download size, and an engine note driven live from RPM sounds better than a
 * looped sample anyway.
 *
 * Browsers refuse to start audio before a user gesture, and the Poki build
 * drops the player straight onto the grid without one, so nothing is created
 * until unlock() is called from the first key press or tap. Every call before
 * that is a silent no-op.
 *
 * Everything routes through one master gain, so mute and ad-ducking are a
 * single switch.
 */

const SMOOTH = 0.05;        // setTargetAtTime time constant for continuous sounds
const MASTER = 0.8;

export class GameAudio {
  constructor(muted = false) {
    this.muted = muted;
    this.ducked = false;
    this.ctx = null;
    this.prevSpeed = 0;
    this.prevPos = null;
    this.thudCooldown = 0;
  }

  /** Call from a user gesture. Safe to call repeatedly. */
  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      try {
        this.ctx = new Ctx();
        this._build();
      } catch {
        this.ctx = null;   // audio is optional — the game runs silent
        return;
      }
    }
    if (this.ctx.state === 'suspended' && !document.hidden) this.ctx.resume().catch(() => {});
  }

  _build() {
    const ctx = this.ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(comp);
    this._applyMaster(true);

    // 2 seconds of white noise, shared by every noise-based sound
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    // engine: two detuned oscillators plus a sub, through a lowpass
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 600;
    this.engineFilter.Q.value = 2;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter.connect(this.engineGain).connect(this.master);
    this.engineOsc = [
      ['sawtooth', 1, 0.5],
      ['square', 1.006, 0.3],
      ['sine', 0.5, 0.7],
    ].map(([type, mul, level]) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      const g = ctx.createGain();
      g.gain.value = level;
      osc.connect(g).connect(this.engineFilter);
      osc.start();
      return { osc, mul };
    });

    // tyre screech: band-passed noise
    this.screechGain = this._noiseLoop('bandpass', 2400, 5);
    // grass / gravel rumble: low-passed noise
    this.rumbleGain = this._noiseLoop('lowpass', 220, 1);
  }

  _noiseLoop(type, freq, q) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
    return gain;
  }

  _applyMaster(immediate = false) {
    if (!this.ctx) return;
    const target = this.muted || this.ducked ? 0 : MASTER;
    const g = this.master.gain;
    if (immediate) { g.cancelScheduledValues(0); g.value = target; }
    else g.setTargetAtTime(target, this.ctx.currentTime, 0.03);
  }

  setMuted(muted) {
    this.muted = muted;
    this._applyMaster();
  }

  /** Silence everything while an ad plays. */
  duck(on) {
    this.ducked = on;
    this._applyMaster(on);   // cut instantly when the ad starts, fade back in after
  }

  /** Stop the audio clock while the tab is hidden. */
  setHidden(hidden) {
    if (!this.ctx) return;
    if (hidden) this.ctx.suspend().catch(() => {});
    else this.ctx.resume().catch(() => {});
  }

  /** Per-frame: engine, tyres, surface and impacts for the player's car. */
  update(dt, vehicle, ctrl, phase) {
    if (!this.ctx || !vehicle) return;
    const t = this.ctx.currentTime;
    const active = phase === 'racing' || phase === 'countdown';
    const speed = vehicle.speedKmh || 0;
    const throttle = active ? (ctrl?.throttle ?? 0) : 0;

    // four-cylinder firing frequency: 30 Hz at idle, ~260 Hz at the redline
    const firing = (vehicle.rpm || 900) / 30;
    for (const { osc, mul } of this.engineOsc) osc.frequency.setTargetAtTime(firing * mul, t, SMOOTH);
    this.engineFilter.frequency.setTargetAtTime(350 + throttle * 1500 + (vehicle.rpm || 0) * 0.15, t, SMOOTH);
    this.engineGain.gain.setTargetAtTime(active ? 0.07 + 0.11 * throttle : 0, t, active ? SMOOTH : 0.15);

    const onTarmac = vehicle.grounded && !vehicle.offRoad;
    const slide = Math.min(1, Math.max(0, (vehicle.driftAmount - 0.28) / 0.45));
    const screech = active && onTarmac && speed > 25 ? slide * 0.22 : 0;
    this.screechGain.gain.setTargetAtTime(screech, t, 0.06);

    const rumble = active && vehicle.offRoad && speed > 5 ? 0.32 * Math.min(1, speed / 70) : 0;
    this.rumbleGain.gain.setTargetAtTime(rumble, t, 0.08);

    // impacts: a sharp speed loss in one frame without a teleport (resets/respawns move the car)
    const pos = vehicle.position;
    const jumped = this.prevPos && Math.hypot(pos.x - this.prevPos.x, pos.z - this.prevPos.z) > 6;
    this.thudCooldown = Math.max(0, this.thudCooldown - dt);
    const drop = this.prevSpeed - speed;
    if (active && !jumped && drop > 14 && this.thudCooldown === 0) {
      this.thud(Math.min(1, drop / 45));
      this.thudCooldown = 0.35;
    }
    this.prevSpeed = speed;
    this.prevPos = { x: pos.x, z: pos.z };
  }

  thud(strength) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.6 * strength, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.32);

    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.35 * strength, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    src.connect(f).connect(ng).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 0.2);
  }

  _tone(freq, start, dur, { type = 'square', level = 0.16 } = {}) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(level, start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(g).connect(this.master);
    osc.start(start);
    osc.stop(start + dur + 0.02);
  }

  /** Countdown: low beep for 3·2·1, high long beep for GO. */
  beep(go = false) {
    if (!this.ctx) return;
    this._tone(go ? 1046 : 523, this.ctx.currentTime, go ? 0.45 : 0.16);
  }

  /** Finish-line jingle; podium places get the full rising arpeggio. */
  jingle(position) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const notes = position <= 3 ? [523, 659, 784, 1046] : [392, 440, 392];
    notes.forEach((f, i) => this._tone(f, t + i * 0.12, i === notes.length - 1 ? 0.5 : 0.14, { type: 'triangle', level: 0.22 }));
  }

  click() {
    if (!this.ctx) return;
    this._tone(1400, this.ctx.currentTime, 0.05, { type: 'triangle', level: 0.08 });
  }
}
