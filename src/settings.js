const KEY = 'azzurra.settings.v1';

const DEFAULTS = {
  laps: 3,
  aiCount: 5,
  aiSkill: 'normal',        // easy | normal | hard | pro
  playerName: '',
  carColor: 0xb6e832,
  tc: true,
  abs: true,
  quality: 'high',          // low | medium | high
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
  if (!['low', 'medium', 'high'].includes(s.quality)) s.quality = DEFAULTS.quality;
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
  low:    { pixelRatio: 1,   shadows: false, shadowMapSize: 1024, fogFar: 650,  trees: 260, rocks: 90 },
  medium: { pixelRatio: 1.5, shadows: true,  shadowMapSize: 1536, fogFar: 900,  trees: 550, rocks: 170 },
  high:   { pixelRatio: 2,   shadows: true,  shadowMapSize: 2048, fogFar: 1150, trees: 900, rocks: 260 },
};
