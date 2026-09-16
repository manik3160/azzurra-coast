const KEY = 'azzurra.settings.v1';

/** Touch-capable devices (phones and tablets) get the cheap renderer by default. */
function isMobileLike() {
  if (typeof window === 'undefined') return false;
  const touch = (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window;
  return touch && Math.min(window.innerWidth, window.innerHeight) < 900;
}

/**
 * Budget phones report low RAM/cores through these (Chrome/Android only —
 * absent on iOS Safari, which defaults to the safer 'low' tier instead).
 * These players are exactly who bounces in the first minute, so they start
 * on the cheapest preset rather than discovering it's too slow mid-race.
 */
function isLowEnd() {
  if (typeof navigator === 'undefined') return false;
  const mem = navigator.deviceMemory;
  const cores = navigator.hardwareConcurrency;
  return (mem !== undefined && mem <= 2) || (cores !== undefined && cores <= 4);
}

const DEFAULTS = {
  // Poki's audience is casual and time-to-fun is what its playtests measure, so
  // the portal build defaults to a single lap (~80s) instead of a 4-minute race.
  laps: __POKI__ ? 1 : 3,
  aiCount: isMobileLike() ? 3 : 5,   // fewer rivals = fewer suspension raycasts per frame on weak phones
  aiSkill: 'normal',        // easy | normal | hard | pro
  playerName: '',
  carColor: 0xb6e832,
  tc: true,
  abs: true,
  quality: isMobileLike() ? (isLowEnd() ? 'potato' : 'low') : 'high',   // potato | low | medium | high
  premiumColorsUnlocked: !__POKI__,   // Poki build gates these behind a rewarded ad
  muted: false,
  racesFinished: 0,        // drives the first-race tutorial
  // career (Poki build) — see career.js
  coins: 0,
  engineLvl: 0,
  gripLvl: 0,
  cupTier: 0,
  cup: null,               // { race, points } while a cup is in progress
};

const SKILL_SCALE = { easy: 0.55, normal: 0.78, hard: 0.92, pro: 1.02 };

function randomName() {
  const n = 1000 + Math.floor(Math.random() * 9000);
  return `Driver${n}`;
}

function load() {
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch { /* corrupt or blocked storage — fall back to defaults */ }
  const s = { ...DEFAULTS, ...stored };
  s.laps = clampInt(s.laps, 1, 10, DEFAULTS.laps);
  s.aiCount = clampInt(s.aiCount, 0, 9, DEFAULTS.aiCount);
  if (!SKILL_SCALE[s.aiSkill]) s.aiSkill = DEFAULTS.aiSkill;
  if (!['potato', 'low', 'medium', 'high'].includes(s.quality)) s.quality = DEFAULTS.quality;
  s.racesFinished = clampInt(s.racesFinished, 0, 1e6, 0);
  s.coins = clampInt(s.coins, 0, 1e9, 0);
  s.engineLvl = clampInt(s.engineLvl, 0, 5, 0);
  s.gripLvl = clampInt(s.gripLvl, 0, 5, 0);
  s.cupTier = clampInt(s.cupTier, 0, 4, 0);
  const cupOk = s.cup && typeof s.cup === 'object' && Number.isInteger(s.cup.race)
    && s.cup.race >= 0 && s.cup.race < 10 && s.cup.points && typeof s.cup.points === 'object';
  if (!cupOk) s.cup = null;
  if (!s.playerName || !s.playerName.trim()) s.playerName = randomName();
  return s;
}

function clampInt(v, min, max, fallback) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

export const settings = load();

export function saveSettings(patch) {
  Object.assign(settings, patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch { /* storage unavailable (private mode, quota) — settings stay in-memory only */ }
  return settings;
}

export function skillValue(skillKey) {
  return SKILL_SCALE[skillKey] ?? SKILL_SCALE.normal;
}

export const QUALITY_PRESETS = {
  potato: { pixelRatio: 1,   shadows: false, shadowMapSize: 512,  fogFar: 480,  trees: 130, rocks: 45 },
  low:    { pixelRatio: 1,   shadows: false, shadowMapSize: 1024, fogFar: 650,  trees: 260, rocks: 90 },
  medium: { pixelRatio: 1.5, shadows: true,  shadowMapSize: 1536, fogFar: 900,  trees: 550, rocks: 170 },
  high:   { pixelRatio: 2,   shadows: true,  shadowMapSize: 2048, fogFar: 1150, trees: 900, rocks: 260 },
};
// One rung down the ladder each time the adaptive monitor in main.js decides
// the device can't hold its frame rate.
export const QUALITY_STEP_DOWN = { high: 'medium', medium: 'low', low: 'potato', potato: 'potato' };
