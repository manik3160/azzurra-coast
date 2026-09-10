/**
 * On-screen touch controls.
 *
 * Scheme: auto-throttle (the car drives itself forward), with large left/right
 * steering pads and brake / handbrake buttons. This is the standard mobile
 * racing layout — lowest skill floor, playable one-handed, and it keeps the
 * finger count down on a phone screen.
 *
 * Produces exactly the same normalised control object as Input.sample(), so the
 * vehicle code can't tell the two apart.
 */

const HOLD_KEYS = ['left', 'right', 'brake', 'handbrake'];

export function isTouchDevice() {
  if (typeof window === 'undefined') return false;
  // Tablets must get the mobile scheme too, so go on touch capability rather
  // than a width breakpoint.
  return (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window;
}

export class TouchControls {
  constructor(root) {
    this.root = root;
    this.active = new Map();   // control name -> Set of pointerIds holding it
    this.enabled = true;
    this.steer = 0;
    this.throttle = 0;
    this.brake = 0;
    this.visible = false;
    this.onPause = null;

    for (const k of HOLD_KEYS) this.active.set(k, new Set());

    root.querySelectorAll('[data-touch]').forEach((el) => {
      const name = el.dataset.touch;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (name === 'pause') { this.onPause?.(); return; }
        el.setPointerCapture?.(e.pointerId);
        this.active.get(name)?.add(e.pointerId);
        el.classList.add('held');
      });
      const release = (e) => {
        if (name === 'pause') return;
        this.active.get(name)?.delete(e.pointerId);
        if (!this.active.get(name)?.size) el.classList.remove('held');
      };
      el.addEventListener('pointerup', release);
      el.addEventListener('pointercancel', release);
      el.addEventListener('pointerleave', release);
      // stop the browser turning a held pad into a scroll / text selection
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    });

    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.releaseAll();
    });
  }

  releaseAll() {
    for (const k of HOLD_KEYS) this.active.get(k).clear();
    this.root.querySelectorAll('[data-touch]').forEach((el) => el.classList.remove('held'));
  }

  show(v) {
    this.visible = v;
    this.root.classList.toggle('hidden', !v);
    if (!v) this.releaseAll();
  }

  held(name) { return (this.active.get(name)?.size ?? 0) > 0; }

  /** Same shape as Input.sample(dt). */
  sample(dt) {
    if (!this.enabled) {
      this.steer = 0; this.throttle = 0; this.brake = 0;
      return { throttle: 0, brake: 0, steer: 0, handbrake: false };
    }

    const left = this.held('left');
    const right = this.held('right');
    const braking = this.held('brake');
    const handbrake = this.held('handbrake');

    // auto-throttle: ease off when braking rather than fighting it
    const wantThrottle = braking ? 0 : 1;
    const rise = (v, t, r) => v + Math.max(-r * dt, Math.min(r * dt, t - v));
    this.throttle = rise(this.throttle, wantThrottle, wantThrottle > this.throttle ? 3.4 : 6);
    this.brake = rise(this.brake, braking ? 1 : 0, 8);

    const st = (left ? 1 : 0) - (right ? 1 : 0);
    this.steer = rise(this.steer, st, st === 0 ? 6 : 4.2);

    return { throttle: this.throttle, brake: this.brake, steer: this.steer, handbrake };
  }
}
