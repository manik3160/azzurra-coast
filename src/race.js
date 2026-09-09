import * as THREE from 'three';

export class Race {
  constructor(track, entries, totalLaps = 3) {
    this.track = track;
    this.totalLaps = totalLaps;
    this.time = 0;
    this.started = false;
    this.over = false;
    this.entries = entries.map((e) => ({
      vehicle: e.vehicle,
      ai: e.ai || null,
      name: e.name,
      color: e.color,
      isPlayer: !!e.isPlayer,
      idx: nearestIndex(track, e.vehicle.position, 0, track.samples),
      lap: 0,
      lapStart: 0,
      lapTimes: [],
      best: null,
      finished: false,
      finishTime: null,
      position: 0,
      wrongWay: false,
    }));
  }

  reset() {
    this.time = 0;
    this.started = false;
    this.over = false;
    for (const e of this.entries) {
      e.lap = 0; e.lapTimes = []; e.best = null; e.finished = false;
      e.finishTime = null; e.lapStart = 0;
      e.idx = nearestIndex(this.track, e.vehicle.position, 0, this.track.samples);
    }
  }

  update(dt) {
    if (this.started && !this.over) this.time += dt;
    const n = this.track.samples;

    for (const e of this.entries) {
      const prev = e.idx;
      e.idx = nearestIndex(this.track, e.vehicle.position, prev, 70);

      const fwd0 = e.vehicle.forward;
      const t0 = this.track.tangent[e.idx];
      e.wrongWay = e.vehicle.speedKmh > 25 && (fwd0.x * t0.x + fwd0.z * t0.z) < -0.35;
      if (e.finished) { e.progress = e.lap * n + e.idx; continue; }

      const delta = shortestDelta(prev, e.idx, n);
      if (prev > n * 0.7 && e.idx < n * 0.3 && delta > 0) {
        // crossed the start / finish line forwards
        e.lap++;
        if (e.lap > 1) {
          const t = this.time - e.lapStart;
          e.lapTimes.push(t);
          if (e.best === null || t < e.best) e.best = t;
        }
        e.lapStart = this.time;
        if (e.lap > this.totalLaps) {
          e.finished = true;
          e.finishTime = this.time;
        }
      } else if (prev < n * 0.3 && e.idx > n * 0.7 && delta < 0) {
        e.lap = Math.max(0, e.lap - 1);
      }

      e.progress = e.lap * n + e.idx;
    }

    const order = this.entries.slice().sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.progress - a.progress;
    });
    order.forEach((e, i) => { e.position = i + 1; });
    this.order = order;

    if (!this.over && this.entries.every((e) => e.finished)) this.over = true;
    const player = this.entries.find((e) => e.isPlayer);
    if (!this.over && player && player.finished) this.over = true;
    return order;
  }

  get player() { return this.entries.find((e) => e.isPlayer); }
}

export function nearestIndex(track, pos, around, window) {
  const n = track.samples;
  let best = around, bestD = Infinity;
  const from = window >= n ? 0 : around - Math.floor(window / 2);
  const count = window >= n ? n : window;
  for (let k = 0; k < count; k++) {
    const i = ((from + k) % n + n) % n;
    const c = track.center[i];
    const d = (c.x - pos.x) ** 2 + (c.z - pos.z) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

function shortestDelta(a, b, n) {
  let d = b - a;
  if (d > n / 2) d -= n;
  if (d < -n / 2) d += n;
  return d;
}

export function formatTime(t) {
  if (t === null || t === undefined) return '—';
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t * 100) % 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

/** Grid slots behind the start / finish line, two-by-two. */
export function gridSlots(track, count) {
  const n = track.samples;
  const slots = [];
  const step = track.center[0].distanceTo(track.center[1]);
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / 2);
    const side = i % 2 ? 1 : -1;
    const back = 10 + row * 9;
    const idx = ((-Math.round(back / step)) % n + n) % n;
    const c = track.center[idx];
    const nm = track.normal[idx];
    const t = track.tangent[idx];
    slots.push({
      position: new THREE.Vector3(c.x + nm.x * side * 3.2, 0.9, c.z + nm.z * side * 3.2),
      heading: Math.atan2(t.x, t.z),
      idx,
    });
  }
  return slots;
}
