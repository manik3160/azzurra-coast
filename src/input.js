export class Input {
  constructor(target = window) {
    this.keys = new Set();
    this.throttle = 0;
    this.brake = 0;
    this.steer = 0;
    this.onKey = new Map();
    this.enabled = true;

    target.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', ' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
      this.keys.add(k);
      const cb = this.onKey.get(k);
      if (cb) cb();
    });
    target.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  bind(key, cb) { this.onKey.set(key, cb); }

  has(...ks) { return ks.some((k) => this.keys.has(k)); }

  sample(dt) {
    const up = this.enabled && this.has('w', 'arrowup');
    const down = this.enabled && this.has('s', 'arrowdown');
    const left = this.enabled && this.has('a', 'arrowleft');
    const rightK = this.enabled && this.has('d', 'arrowright');

    const rise = (v, t, r) => v + Math.max(-r * dt, Math.min(r * dt, t - v));
    this.throttle = rise(this.throttle, up ? 1 : 0, up ? 3.4 : 6);
    this.brake = rise(this.brake, down ? 1 : 0, 8);
    const st = (left ? 1 : 0) - (rightK ? 1 : 0);
    this.steer = rise(this.steer, st, st === 0 ? 6 : 4.2);

    return {
      throttle: this.throttle,
      brake: this.brake,
      steer: this.steer,
      handbrake: this.enabled && this.keys.has(' '),
    };
  }
}
