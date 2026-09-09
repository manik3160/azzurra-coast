import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { buildTrack, ROAD_HALF } from './track.js';
import { buildScenery } from './scenery.js';
import { Vehicle } from './vehicle.js';
import { AIDriver, AI_PROFILES } from './ai.js';
import { Race, gridSlots, nearestIndex, formatTime } from './race.js';
import { ChaseCamera } from './camera.js';
import { Input } from './input.js';
import { Hud } from './hud.js';
import { Minimap } from './minimap.js';

const TOTAL_LAPS = 3;
const DEBUG = new URLSearchParams(location.search).has('debug');

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xc6d4d6, 210, 1150);

const camera = new THREE.PerspectiveCamera(64, 1, 0.3, 4000);
scene.add(camera);

const hemi = new THREE.HemisphereLight(0xdff0ff, 0x6b7a55, 1.05);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff4e2, 1.55);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 320;
const SH = 90;
Object.assign(sun.shadow.camera, { left: -SH, right: SH, top: SH, bottom: -SH });
sun.shadow.bias = -0.0009;
scene.add(sun, sun.target);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------- boot
const state = {
  phase: 'loading',   // loading | ready | countdown | racing | paused | finished
  countdown: 0,
};

let world, track, race, chase, hud, minimap, input, player, entries = [];

await RAPIER.init();
world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
world.timestep = 1 / 120;

track = buildTrack(scene, world, RAPIER);
buildScenery(scene, track);

const slots = gridSlots(track, AI_PROFILES.length + 1);

// AI first, player at the back of the grid.
AI_PROFILES.forEach((p, i) => {
  const s = slots[i];
  const v = new Vehicle({ world, RAPIER, scene }, {
    name: p.name, color: p.color, accent: p.accent,
    position: s.position, heading: s.heading,
  });
  entries.push({ vehicle: v, name: p.name, color: p.color, ai: new AIDriver(v, track, p), isPlayer: false });
});
{
  const s = slots[AI_PROFILES.length];
  player = new Vehicle({ world, RAPIER, scene }, {
    name: 'You', color: 0xb6e832, accent: 0xf3a13a,
    position: s.position, heading: s.heading, isPlayer: true,
  });
  entries.push({ vehicle: player, name: 'You', color: 0xb6e832, isPlayer: true });
}

const vehicles = entries.map((e) => e.vehicle);
race = new Race(track, entries, TOTAL_LAPS);
chase = new ChaseCamera(camera);
chase.snap(player);
hud = new Hud();
hud.setTotals(entries.length, TOTAL_LAPS);
minimap = new Minimap(document.getElementById('minimap'), track);
input = new Input();

input.bind('c', () => { if (state.phase === 'racing') hud.setCamera(chase.cycle()); });
input.bind('r', () => { if (state.phase === 'racing') respawn(race.player); });
input.bind('escape', () => {
  if (state.phase === 'racing') pause();
  else if (state.phase === 'paused') resume();
});
document.getElementById('camChip').onclick = () => hud.setCamera(chase.cycle());
document.getElementById('pauseChip').onclick = () => (state.phase === 'racing' ? pause() : resume());

const overlay = document.getElementById('overlay');
const overlayBody = document.getElementById('overlayBody');
const startBtn = document.getElementById('startBtn');
document.getElementById('loading').classList.add('hidden');
state.phase = 'ready';
startBtn.onclick = () => startRace();

// ---------------------------------------------------------------- helpers
function onRoad(point, hint) {
  const i = nearestIndex(track, point, hint, 60);
  const c = track.center[i];
  const n = track.normal[i];
  const lat = Math.abs((point.x - c.x) * n.x + (point.z - c.z) * n.z);
  return lat <= ROAD_HALF + 1.0;
}

function respawn(entry) {
  const i = (entry.idx + 4) % track.samples;
  const c = track.line[i];
  const t = track.tangent[i];
  entry.vehicle.resetTo(new THREE.Vector3(c.x, 1.1, c.z), Math.atan2(t.x, t.z));
}

/** Un-stick cars that have flipped or beached themselves on a barrier. */
function recover(e, dt) {
  const v = e.vehicle;
  const flipped = v.tilt < 0.35;
  const beached = e.isPlayer
    ? (v.speedKmh < 5 && (v.offRoad || !v.grounded))
    : v.speedKmh < 6;   // an AI that has stopped is always stuck
  e.stuckFor = (flipped || beached) ? (e.stuckFor || 0) + dt : 0;
  const limit = e.isPlayer ? 3.5 : 2.2;
  if (e.stuckFor > limit) {
    respawn(e.entry);
    e.stuckFor = 0;
    if (e.isPlayer) hud.message('RECOVERED', { small: true, hold: 1.1 });
  }
}

function startRace() {
  overlay.classList.add('hidden');
  hud.show(true);
  hud.setCamera(chase.name);
  state.phase = 'countdown';
  state.countdown = 3.6;
  race.reset();
  input.enabled = false;
}

function pause() {
  state.phase = 'paused';
  input.enabled = false;
  overlayBody.innerHTML = '<p class="lede">Paused</p>';
  startBtn.textContent = 'Resume';
  startBtn.onclick = resume;
  overlay.classList.remove('hidden');
}

function resume() {
  overlay.classList.add('hidden');
  state.phase = 'racing';
  input.enabled = true;
}

function finish() {
  state.phase = 'finished';
  input.enabled = false;
  const rows = race.order.map((e) => {
    const swatch = `#${(e.isPlayer ? 0xc8f527 : e.color).toString(16).padStart(6, '0')}`;
    const t = e.finished ? formatTime(e.finishTime) : `lap ${Math.max(1, e.lap)}/${TOTAL_LAPS}`;
    return `<tr class="${e.isPlayer ? 'you' : ''}"><td>${e.position}</td>
      <td><span class="swatch" style="background:${swatch}"></span>${e.name}</td><td>${t}</td></tr>`;
  }).join('');
  const p = race.player;
  overlayBody.innerHTML = `
    <p class="lede">Finished P${p.position} · best lap ${formatTime(p.best)}</p>
    <table class="results">${rows}</table>`;
  startBtn.textContent = 'Race Again';
  startBtn.onclick = () => {
    slots.forEach((s, i) => entries[i].vehicle.resetTo(s.position, s.heading));
    race.reset();
    chase.snap(player);
    startRace();
  };
  overlay.classList.remove('hidden');
  hud.message('');
}

// ---------------------------------------------------------------- loop
const FIXED = 1 / 120;
let acc = 0;
let last = performance.now();
let lastCount = -1;
let ctrlOverride = null;

function step(dt) {
  const ctrl = ctrlOverride || input.sample(dt);
  const racing = state.phase === 'racing' || state.phase === 'countdown';

  if (racing) {
    if (state.phase === 'countdown') {
      state.countdown -= dt;
      const n = Math.ceil(state.countdown - 0.6);
      if (n !== lastCount) {
        lastCount = n;
        if (n > 0) hud.message(String(n), { hold: 1 });
        else hud.message('GO', { hold: 0.9 });
      }
      if (state.countdown <= 0) {
        state.phase = 'racing';
        input.enabled = true;
        race.started = true;
      }
    }

    acc += dt;
    let steps = 0;
    while (acc >= FIXED && steps < 6) {
      const active = state.phase === 'racing';
      for (const e of entries) {
        const c = e.isPlayer
          ? (active ? ctrl : IDLE_CTRL)
          : (active ? e.ai.control(FIXED, e.entry.idx, race.time, vehicles) : IDLE_CTRL);
        e.vehicle.update(FIXED, c, e.surface);
      }
      world.step();
      acc -= FIXED;
      steps++;
    }
    if (steps === 6) acc = 0;

    race.update(dt);
    if (state.phase === 'racing') for (const e of entries) recover(e, dt);
    if (race.over && state.phase === 'racing') finish();

    hud.update(dt, race, player);
    minimap.draw(race.entries);
  }

  chase.update(dt, player);

  const p = player.position;
  sun.position.set(p.x + 90, 150, p.z + 60);
  sun.target.position.set(p.x, 0, p.z);
  sun.target.updateMatrixWorld();

  renderer.render(scene, camera);
}

const IDLE_CTRL = { throttle: 0, brake: 1, steer: 0, handbrake: true };

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (dt <= 0) return;
  step(dt);
}

// link race entries back to the drivable entries so the AI knows its track index
race.entries.forEach((re, i) => {
  entries[i].entry = re;
  entries[i].surface = (pt) => onRoad(pt, re.idx);
});

if (DEBUG) {
  window.__game = {
    world, track, race, entries, player, state, chase, step, input, hud,
    setControls: (c) => { ctrlOverride = c; if (c) input.enabled = false; },
    sim: (seconds, dt = 1 / 60) => { for (let i = 0; i < Math.round(seconds / dt); i++) step(dt); },
    start: () => startRace(),
  };
}

requestAnimationFrame(frame);
