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
    this.byPointer = new Map(); // pointerId -> { name, el } — release is driven from here
    this.enabled = true;
    this.steer = 0;
    this.throttle = 0;
    this.brake = 0;
    this.visible = false;
    this.onPause = null;

    for (const k of HOLD_KEYS) this.active.set(k, new Set());

    const press = (name, el, pointerId) => {
      if (name === 'pause') { this.onPause?.(); return; }
      if (name === 'reset') { if (this.enabled) this.onReset?.(); return; }
      this.byPointer.set(pointerId, { name, el });
      this.active.get(name)?.add(pointerId);
      el.classList.add('held');
    };

    // Release is driven by window-level listeners rather than the pad's own
    // pointerup/pointercancel. iOS Safari does not reliably honour
    // setPointerCapture for touch pointers, so the release event can end up
    // targeting whatever element the finger happens to be over (or nothing,
    // if it lifted off-screen) instead of the pad that captured the press —
    // the pad's own listener then never fires and the control reads as
    // permanently held. A window listener keyed by pointerId doesn't depend
    // on which element the event lands on, so it always finds the pad.
    const release = (e) => {
      const hit = this.byPointer.get(e.pointerId);
      if (!hit) return;
      this.byPointer.delete(e.pointerId);
      this.active.get(hit.name)?.delete(e.pointerId);
      if (!this.active.get(hit.name)?.size) hit.el.classList.remove('held');
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    // Belt-and-braces for browsers/situations where a pointerup/pointercancel
    // never arrives at all: the underlying Touch API's `identifier` is the
    // same id as the PointerEvent's `pointerId` for a touch-originated
    // pointer, so changedTouches tells us definitively which pointers just
    // ended, independent of setPointerCapture (which can fail — see above —
    // and isn't a reliable signal for "is this still down").
    window.addEventListener('touchend', (e) => this._reconcile(e), { passive: true });
    window.addEventListener('touchcancel', (e) => this._reconcile(e), { passive: true });

    root.querySelectorAll('[data-touch]').forEach((el) => {
      const name = el.dataset.touch;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        // Capture is a nice-to-have (keeps the press tracking the pad if the
        // finger drifts slightly); it can throw on some devices/timings, and
        // must never be allowed to stop the control itself from registering.
        try { el.setPointerCapture?.(e.pointerId); } catch { /* release logic doesn't depend on this */ }
        press(name, el, e.pointerId);
      });
      // stop the browser turning a held pad into a scroll / text selection / callout
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    });

    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.releaseAll();
    });
  }

  /** Releases exactly the pointers a native touchend/touchcancel reports as
   *  ended — a redundant safety net alongside the pointerup/pointercancel
   *  listeners above, for the rare case one of those never arrives. */
  _reconcile(e) {
    for (const t of e.changedTouches) {
      const hit = this.byPointer.get(t.identifier);
      if (!hit) continue;
      this.byPointer.delete(t.identifier);
      this.active.get(hit.name)?.delete(t.identifier);
      if (!this.active.get(hit.name)?.size) hit.el.classList.remove('held');
    }
  }

  releaseAll() {
    for (const k of HOLD_KEYS) this.active.get(k).clear();
    this.byPointer.clear();
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
