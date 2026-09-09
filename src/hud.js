import { formatTime } from './race.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.el = {
      root: $('hud'), pos: $('pos'), posTotal: $('posTotal'), lap: $('lap'), lapTotal: $('lapTotal'),
      raceTime: $('raceTime'), bestLap: $('bestLap'), speed: $('speed'), gear: $('gear'),
      throttle: $('throttleFill'), camName: $('camName'), msg: $('centerMsg'),
      tcState: $('tcState'), absState: $('absState'),
    };
    this.msgTimer = 0;
  }

  show(v) { this.el.root.classList.toggle('hidden', !v); }

  setTotals(cars, laps) {
    this.el.posTotal.textContent = cars;
    this.el.lapTotal.textContent = laps;
  }

  message(text, { small = false, hold = 1 } = {}) {
    const m = this.el.msg;
    m.textContent = text;
    m.classList.toggle('small', small);
    m.classList.toggle('show', !!text);
    this.msgTimer = hold;
  }

  update(dt, race, vehicle) {
    const p = race.player;
    this.el.pos.textContent = p.position;
    this.el.lap.textContent = Math.min(race.totalLaps, Math.max(1, p.lap));
    this.el.raceTime.textContent = formatTime(race.time);
    this.el.bestLap.textContent = p.best === null ? '—' : formatTime(p.best);
    this.el.bestLap.classList.toggle('dim', p.best === null);
    this.el.speed.textContent = Math.round(vehicle.speedKmh);
    this.el.gear.textContent = vehicle.reverse ? 'R' : vehicle.gear;
    this.el.tcState.textContent = `TC ${vehicle.tc ? 'ON' : 'OFF'}`;
    this.el.absState.textContent = `ABS ${vehicle.abs ? 'ON' : 'OFF'}`;
    const rev = Math.max(0.015, Math.min(1, (vehicle.rpm - 900) / 6900));
    this.el.throttle.style.clipPath = `inset(0 ${(1 - rev) * 100}% 0 0)`;

    if (this.msgTimer > 0) {
      this.msgTimer -= dt;
      if (this.msgTimer <= 0) this.el.msg.classList.remove('show');
    }
    if (p.wrongWay && this.msgTimer <= 0) this.message('WRONG WAY', { small: true, hold: 0.4 });
  }

  setCamera(name) { this.el.camName.textContent = name; }
}
