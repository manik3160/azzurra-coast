import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { buildTrack, ROAD_HALF } from './track.js';
import { buildScenery } from './scenery.js';
import { Vehicle } from './vehicle.js';
import { RemoteVehicle } from './remoteVehicle.js';
import { AIDriver, makeProfiles } from './ai.js';
import { Race, gridSlots, nearestIndex, formatTime } from './race.js';
import { ChaseCamera } from './camera.js';
import { Input } from './input.js';
import { Hud } from './hud.js';
import { Minimap } from './minimap.js';
import { Menu } from './ui/menu.js';
import { settings, saveSettings, skillValue, QUALITY_PRESETS } from './settings.js';
import * as poki from './poki.js';
import { TouchControls, isTouchDevice } from './touch.js';

// Multiplayer + leaderboard are loaded dynamically so the Poki build can drop
// them entirely: Poki blocks external requests and forbids multiplayer
// backends, and src/net/supabase.js creates its client at module scope, so a
// static import would be bundled even when unused. On the web build this also
// keeps Supabase off the initial load.
let net = null;
let netAvailable = false;

async function loadNet() {
  if (__POKI__ || net) return net;
  const [supa, lobby, snap, lb] = await Promise.all([
    import('./net/supabase.js'),
    import('./net/lobby.js'),
    import('./net/snapshot.js'),
    import('./leaderboard.js'),
  ]);
  net = { ...supa, ...lobby, ...snap, ...lb };
  return net;
}

const DEBUG = new URLSearchParams(location.search).has('debug');
const NET_HZ = 10;

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(64, 1, 0.3, 4000);
scene.add(camera);

const hemi = new THREE.HemisphereLight(0xdff0ff, 0x6b7a55, 1.05);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff4e2, 1.55);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 320;
const SH = 90;
Object.assign(sun.shadow.camera, { left: -SH, right: SH, top: SH, bottom: -SH });
sun.shadow.bias = -0.0009;
scene.add(sun, sun.target);

function applyQuality(q) {
  const preset = QUALITY_PRESETS[q] ?? QUALITY_PRESETS.high;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, preset.pixelRatio));
  renderer.shadowMap.enabled = preset.shadows;
  sun.castShadow = preset.shadows;
  sun.shadow.mapSize.set(preset.shadowMapSize, preset.shadowMapSize);
  scene.fog = new THREE.Fog(0xc6d4d6, preset.fogFar * 0.18, preset.fogFar);
  return preset;
}
const bootQuality = applyQuality(settings.quality);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------- boot
const state = { phase: 'menu', countdown: 0 };

// 4 suspension raycasts per car per substep is the dominant CPU cost, so
// mobile runs physics at half rate to protect Poki's 30fps floor.
const PHYSICS_HZ = isTouchDevice() ? 60 : 120;
const FIXED = 1 / PHYSICS_HZ;

await RAPIER.init();
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
world.timestep = FIXED;

const track = buildTrack(scene, world, RAPIER);
buildScenery(scene, track, bootQuality);

// static overview camera until the first race starts
camera.position.set(track.center[0].x - 40, 22, track.center[0].z + 10);
camera.lookAt(track.center[0].x, 2, track.center[0].z);
sun.position.set(track.center[0].x + 90, 150, track.center[0].z + 60);
sun.target.position.set(track.center[0].x, 0, track.center[0].z);
sun.target.updateMatrixWorld();

const chase = new ChaseCamera(camera);
const hud = new Hud();
const minimap = new Minimap(document.getElementById('minimap'), track);
const input = new Input();
const touch = new TouchControls(document.getElementById('touch'));
const useTouch = isTouchDevice();

// Poki SDK first, then the multiplayer chunk (web build only). Neither is
// allowed to block the game from starting if it fails.
await poki.initPoki();
if (!__POKI__) {
  try {
    await loadNet();
    netAvailable = !!net?.isConfigured;
  } catch {
    netAvailable = false;   // multiplayer simply stays disabled
  }
}

document.getElementById('loading').classList.add('hidden');
// The game is playable from here: assets built, first frame about to render.
poki.loadingFinished();

const overlay = document.getElementById('overlay');
const overlayBody = document.getElementById('overlayBody');
const startBtn = document.getElementById('startBtn');

const menu = new Menu({
  root: document.getElementById('menuOverlay'),
  panel: document.getElementById('menuPanel'),
  settings, netAvailable,
  handlers: {
    onSingleStart: () => startSinglePlayer(),
    onSettingsSave: (patch) => { saveSettings(patch); applyQuality(settings.quality); menu.showMain(); },
    onOpenLeaderboard: async () => {
      menu.showLobbyConnecting('Leaderboard');
      const { rows, error } = await net.fetchTopTimes();
      menu.showLeaderboard(rows, error);
    },
    onOpenMultiplayer: () => menu.showMultiplayerChoice(),
    onHost: (info) => hostLobby(info),
    onJoin: (code, info) => joinLobby(code, info),
    onLobbySettingsChange: (patch) => {
      Object.assign(lobbySettings, patch);
      currentLobby?.sendSettings(lobbySettings);
      renderLobbyScreen();
    },
    onLobbyStart: () => beginAsHost(),
    onLeaveLobby: async () => {
      if (currentLobby) { await currentLobby.leave(); currentLobby = null; }
      lobbyRoster = []; lobbySettings = null;
      menu.showMain();
    },
  },
});
menu.showMain();

// ---------------------------------------------------------------- multiplayer state (pre-race)
let currentLobby = null;
let lobbyRoster = [];
let lobbyHostId = null;
let lobbySettings = null;

function renderLobbyScreen() {
  if (!currentLobby) return;
  const roster = lobbyRoster.map((r) => ({ ...r, isHost: r.clientId === lobbyHostId }));
  menu.showLobby({
    code: currentLobby.code, roster, isHost: currentLobby.isHost,
    settings: lobbySettings ?? { laps: settings.laps, aiCount: settings.aiCount },
  });
}

function connectLobby(code, playerName) {
  if (!netAvailable) return Promise.reject(new Error('Multiplayer is not configured on this deployment.'));
  return new net.Lobby({
    code, name: playerName, color: settings.carColor,
    onRoster: (roster, hostId) => {
      lobbyRoster = roster; lobbyHostId = hostId;
      if (!session) renderLobbyScreen();
    },
    onSettings: (payload) => {
      lobbySettings = payload.settings;
      if (!session) renderLobbyScreen();
    },
    onStart: (payload) => { if (!currentLobby.isHost) beginRace(payload, false); },
    onState: (payload) => routeNetworkState(payload),
    onFinish: (payload) => hud.message(`${payload.name} finished P${payload.position}`, { small: true, hold: 1.8 }),
    onHostChange: () => { if (!session) renderLobbyScreen(); },
  }).connect();
}

async function hostLobby({ playerName }) {
  saveSettings({ playerName });
  menu.showLobbyConnecting('Hosting…');
  try {
    currentLobby = await connectLobby(net.randomCode(), playerName);
    lobbySettings = { laps: settings.laps, aiCount: settings.aiCount };
    renderLobbyScreen();
  } catch (err) {
    menu.showMultiplayerChoice(`Could not host: ${err.message || err}`);
  }
}

async function joinLobby(code, { playerName }) {
  if (!code || code.length < 4) { menu.showMultiplayerChoice('Enter the 4-character room code.'); return; }
  saveSettings({ playerName });
  menu.showLobbyConnecting(`Joining ${code}…`);
  try {
    currentLobby = await connectLobby(code, playerName);
    renderLobbyScreen();
  } catch (err) {
    menu.showMultiplayerChoice(`Could not join "${code}": ${err.message || err}`);
  }
}

function beginAsHost() {
  if (!currentLobby?.isHost) return;
  const humans = lobbyRoster;
  const aiProfiles = makeProfiles(lobbySettings.aiCount, skillValue(settings.aiSkill))
    .map((p, i) => ({ ...p, id: `ai${i}`, slotIndex: humans.length + i }));
  const grid = humans.map((r, i) => ({ clientId: r.clientId, slotIndex: i, name: r.name, color: r.color }));
  const payload = { settings: { ...lobbySettings }, grid, aiProfiles, countdown: 3.6 };
  currentLobby.sendStart(payload);
  beginRace(payload, true);
}

// ---------------------------------------------------------------- session lifecycle
let session = null; // { entries, race, player, netRole, lobby, remoteHumans, remoteAI }
let netAcc = 0;
let prevFinished = false;

function finalizeEntries(entries, race) {
  race.entries.forEach((re, i) => {
    entries[i].entry = re;
    entries[i].surface = (pt) => onRoad(pt, re.idx);
  });
}

function disposeSession(s) {
  if (!s) return;
  for (const e of s.entries) e.vehicle.dispose();
}

function startSinglePlayer() {
  menu.hide();
  const aiProfiles = makeProfiles(settings.aiCount, skillValue(settings.aiSkill));
  const slots = gridSlots(track, aiProfiles.length + 1);
  const entries = [];

  aiProfiles.forEach((p, i) => {
    const s = slots[i];
    const v = new Vehicle({ world, RAPIER, scene }, {
      name: p.name, color: p.color, accent: p.accent, position: s.position, heading: s.heading,
    });
    entries.push({ vehicle: v, name: p.name, color: p.color, ai: new AIDriver(v, track, p), isPlayer: false });
  });

  const s = slots[aiProfiles.length];
  const player = new Vehicle({ world, RAPIER, scene }, {
    name: settings.playerName, color: settings.carColor, accent: 0xf3a13a,
    position: s.position, heading: s.heading, isPlayer: true, tc: settings.tc, abs: settings.abs,
  });
  entries.push({ vehicle: player, name: settings.playerName, color: settings.carColor, isPlayer: true });

  disposeSession(session);
  const race = new Race(track, entries, settings.laps);
  finalizeEntries(entries, race);
  session = { entries, race, player, netRole: null, lobby: null, remoteHumans: null, remoteAI: null };
  hud.setTotals(entries.length, race.totalLaps);
  chase.snap(player);
  beginCountdownWithAd(3.6);
}

function beginRace(payload, isHost) {
  menu.hide();
  const total = payload.grid.length + payload.aiProfiles.length;
  const slots = gridSlots(track, total);
  const entries = [];
  const remoteHumans = new Map();
  const remoteAI = new Map();
  const localAI = [];
  let player = null;

  for (const g of payload.grid) {
    const slot = slots[g.slotIndex];
    if (g.clientId === currentLobby.clientId) {
      const v = new Vehicle({ world, RAPIER, scene }, {
        name: settings.playerName, color: settings.carColor, accent: 0xf3a13a,
        position: slot.position, heading: slot.heading, isPlayer: true, tc: settings.tc, abs: settings.abs,
      });
      player = v;
      entries.push({ vehicle: v, name: settings.playerName, color: settings.carColor, isPlayer: true });
    } else {
      const v = new RemoteVehicle({ world, RAPIER, scene }, {
        name: g.name, color: g.color, accent: 0xf3a13a, position: slot.position, heading: slot.heading,
      });
      remoteHumans.set(g.clientId, v);
      entries.push({ vehicle: v, name: g.name, color: g.color, isPlayer: false });
    }
  }

  for (const p of payload.aiProfiles) {
    const slot = slots[p.slotIndex];
    if (isHost) {
      const v = new Vehicle({ world, RAPIER, scene }, {
        name: p.name, color: p.color, accent: p.accent, position: slot.position, heading: slot.heading,
      });
      const ai = new AIDriver(v, track, p);
      localAI.push({ id: p.id, vehicle: v });
      entries.push({ vehicle: v, name: p.name, color: p.color, ai, isPlayer: false });
    } else {
      const v = new RemoteVehicle({ world, RAPIER, scene }, {
        name: p.name, color: p.color, accent: p.accent, position: slot.position, heading: slot.heading,
      });
      remoteAI.set(p.id, v);
      entries.push({ vehicle: v, name: p.name, color: p.color, isPlayer: false });
    }
  }

  if (!player) { console.error('Local player was not present in the start payload grid.'); return; }

  disposeSession(session);
  const race = new Race(track, entries, payload.settings.laps);
  finalizeEntries(entries, race);
  session = {
    entries, race, player, netRole: isHost ? 'host' : 'guest', lobby: currentLobby,
    remoteHumans, remoteAI, localAI,
  };
  hud.setTotals(entries.length, race.totalLaps);
  chase.snap(player);
  netAcc = 0;
  beginCountdownWithAd(payload.countdown ?? 3.6);
}

function routeNetworkState(payload) {
  if (!session || session.lobby !== currentLobby || !session.remoteHumans) return;
  const remote = session.remoteHumans.get(payload.clientId);
  if (remote) remote.pushSnapshot({ t: payload.t, ...payload.car });
  if (payload.ai) {
    for (const a of payload.ai) {
      const rv = session.remoteAI.get(a.id);
      if (rv) rv.pushSnapshot({ t: payload.t, ...a.car });
    }
  }
}

function sendNetworkState() {
  const s = session;
  if (!s?.lobby) return;
  const pe = s.race.entries.find((e) => e.isPlayer);
  const car = net.packCar(s.player, { lap: pe.lap, finished: pe.finished, finishTime: pe.finishTime, best: pe.best, wrongWay: pe.wrongWay });
  const extra = {};
  if (s.netRole === 'host') {
    extra.ai = s.localAI.map((a) => {
      const e = s.entries.find((en) => en.vehicle === a.vehicle);
      return { id: a.id, car: net.packCar(a.vehicle, { lap: e.lap, finished: e.finished, finishTime: e.finishTime, best: e.best, wrongWay: e.wrongWay }) };
    });
  }
  s.lobby.sendState(car, extra);
}

// ---------------------------------------------------------------- race helpers
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

/** Un-stick local cars that have flipped or beached themselves on a barrier. */
function recover(e, dt) {
  if (e.vehicle.isRemote) return; // owner's machine handles its own recovery
  const v = e.vehicle;
  const flipped = v.tilt < 0.35;
  const beached = e.isPlayer
    ? (v.speedKmh < 5 && (v.offRoad || !v.grounded))
    : v.speedKmh < 6;
  e.stuckFor = (flipped || beached) ? (e.stuckFor || 0) + dt : 0;
  const limit = e.isPlayer ? 3.5 : 2.2;
  if (e.stuckFor > limit) {
    respawn(e.entry);
    e.stuckFor = 0;
    if (e.isPlayer) hud.message('RECOVERED', { small: true, hold: 1.1 });
  }
}

/**
 * Shows an ad at the natural break before a race, then starts the countdown.
 * Resolves immediately when no ad is available, so this is safe everywhere.
 */
async function beginCountdownWithAd(seconds) {
  await poki.commercialBreak();
  beginCountdown(seconds);
}

function beginCountdown(seconds) {
  overlay.classList.add('hidden');
  hud.show(true);
  touch.show(useTouch);
  hud.setCamera(chase.name);
  state.phase = 'countdown';
  state.countdown = seconds;
  session.race.reset();
  input.enabled = false;
  touch.enabled = false;
  prevFinished = false;
  document.getElementById('overlayLede').textContent =
    `${session.race.totalLaps} lap${session.race.totalLaps > 1 ? 's' : ''} · ${session.entries.length} cars · rear-wheel drive`;
}

function pause() {
  state.phase = 'paused';
  input.enabled = false;
  touch.enabled = false;
  touch.show(false);
  poki.gameplayStop();
  overlayBody.innerHTML = '<p class="lede">Paused</p>';
  startBtn.textContent = 'Resume';
  startBtn.onclick = resume;
  overlay.classList.remove('hidden');
}

/** Coming out of a pause is a natural break, so it gets an ad opportunity. */
async function resume() {
  await poki.commercialBreak();
  overlay.classList.add('hidden');
  state.phase = 'racing';
  input.enabled = true;
  touch.enabled = true;
  touch.show(useTouch);
  poki.gameplayStart();
}

async function submitBestLap(button) {
  const p = session.race.player;
  if (p.best === null) return;
  button.disabled = true;
  button.textContent = 'Submitting…';
  const { error } = await net.submitLapTime({
    playerName: settings.playerName, lapMs: p.best * 1000,
    laps: session.race.totalLaps, aiCount: settings.aiCount, tc: settings.tc, abs: settings.abs,
  });
  button.textContent = error ? 'Failed — try again' : 'Submitted ✓';
  button.disabled = !error;
}

function finish() {
  state.phase = 'finished';
  input.enabled = false;
  touch.enabled = false;
  touch.show(false);
  poki.gameplayStop();
  const race = session.race;
  const multiplayer = !!session.netRole;

  const rows = race.order.map((e) => {
    const swatch = `#${(e.isPlayer ? settings.carColor : e.color).toString(16).padStart(6, '0')}`;
    const t = e.finished ? formatTime(e.finishTime) : `lap ${Math.max(1, e.lap)}/${race.totalLaps}`;
    return `<tr class="${e.isPlayer ? 'you' : ''}"><td>${e.position}</td>
      <td><span class="swatch" style="background:${swatch}"></span>${e.name}</td><td>${t}</td></tr>`;
  }).join('');

  const p = race.player;
  const canSubmit = !__POKI__ && net?.leaderboardEnabled() && p.best !== null;
  overlayBody.innerHTML = `
    <p class="lede">Finished P${p.position} · best lap ${formatTime(p.best)}</p>
    <table class="results">${rows}</table>
    ${canSubmit ? '<button class="btn ghost" id="submitLapBtn" style="width:100%;margin:0 0 10px">Submit best lap</button>' : ''}
    <button class="btn ghost" id="menuBtn" style="width:100%;margin:0">Main Menu</button>
  `;
  if (canSubmit) document.getElementById('submitLapBtn').onclick = (e) => submitBestLap(e.target);
  document.getElementById('menuBtn').onclick = () => {
    overlay.classList.add('hidden');
    hud.show(false);
    disposeSession(session);
    session = null;
    if (multiplayer && currentLobby) renderLobbyScreen();
    else menu.showMain();
  };

  startBtn.textContent = multiplayer ? 'Back to Lobby' : 'Race Again';
  startBtn.onclick = () => {
    if (multiplayer) {
      disposeSession(session);
      session = null;
      overlay.classList.add('hidden');
      hud.show(false);
      if (currentLobby) renderLobbyScreen(); else menu.showMain();
    } else {
      startSinglePlayer();
    }
  };
  overlay.classList.remove('hidden');
  hud.message('');

  if (session.lobby) {
    session.lobby.sendFinish({ name: settings.playerName, position: p.position, finishTime: p.finishTime });
  }
}

// ---------------------------------------------------------------- loop
const IDLE_CTRL = { throttle: 0, brake: 1, steer: 0, handbrake: true };
let acc = 0;
let last = performance.now();
let lastCount = -1;
let ctrlOverride = null;

function step(dt) {
  const kb = input.sample(dt);
  const tc = touch.sample(dt);
  // whichever input the player is actually using wins; touch is additive so a
  // device with both keyboard and touchscreen works either way
  const merged = touch.visible && (tc.throttle || tc.brake || tc.steer || tc.handbrake)
    ? tc
    : (kb.throttle || kb.brake || kb.steer || kb.handbrake ? kb : tc);
  const ctrl = ctrlOverride || (touch.visible ? merged : kb);
  const racing = state.phase === 'racing' || state.phase === 'countdown';

  if (racing && session) {
    const { entries, race, player } = session;
    const vehicles = entries.map((e) => e.vehicle);

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
        touch.enabled = true;
        race.started = true;
        poki.gameplayStart();
      }
    }

    // interpolated cars advance once per render frame, ahead of the physics substeps
    for (const e of entries) if (e.vehicle.isRemote) e.vehicle.update(dt);

    acc += dt;
    let steps = 0;
    while (acc >= FIXED && steps < 6) {
      const active = state.phase === 'racing';
      for (const e of entries) {
        if (e.vehicle.isRemote) continue;
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

    if (session.lobby && (state.phase === 'racing' || state.phase === 'countdown')) {
      netAcc += dt;
      if (netAcc >= 1 / NET_HZ) { netAcc = 0; sendNetworkState(); }
    }

    if (race.over && state.phase === 'racing' && !prevFinished) {
      prevFinished = true;
      finish();
    }

    hud.update(dt, race, player);
    minimap.draw(race.entries);

    chase.update(dt, player);
    const p = player.position;
    sun.position.set(p.x + 90, 150, p.z + 60);
    sun.target.position.set(p.x, 0, p.z);
    sun.target.updateMatrixWorld();
  }

  renderer.render(scene, camera);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (dt <= 0) return;
  step(dt);
}

input.bind('c', () => { if (state.phase === 'racing') hud.setCamera(chase.cycle()); });
input.bind('r', () => { if (state.phase === 'racing' && session) respawn(session.race.player); });
input.bind('escape', () => {
  if (state.phase === 'racing') pause();
  else if (state.phase === 'paused') resume();
});
// Mobile is landscape-only (see #rotate in styles.css); if the player turns the
// device mid-race, pause rather than letting the race run behind the prompt.
if (useTouch && window.matchMedia) {
  const portrait = window.matchMedia('(orientation: portrait)');
  const onOrientation = () => {
    if (portrait.matches && state.phase === 'racing') pause();
  };
  portrait.addEventListener?.('change', onOrientation);
}

document.getElementById('camChip').onclick = () => hud.setCamera(chase.cycle());
document.getElementById('pauseChip').onclick = () => (state.phase === 'racing' ? pause() : resume());

if (DEBUG) {
  window.__game = {
    world, track, state, chase, step, input, hud,
    get race() { return session?.race; },
    get entries() { return session?.entries; },
    get player() { return session?.player; },
    setControls: (c) => { ctrlOverride = c; if (c) input.enabled = false; },
    sim: (seconds, dt = 1 / 60) => { for (let i = 0; i < Math.round(seconds / dt); i++) step(dt); },
    start: () => startSinglePlayer(),
  };
}

requestAnimationFrame(frame);
