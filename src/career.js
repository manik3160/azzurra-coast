/**
 * Cup / career progression for the Poki build.
 *
 * Pure data and rules only — no DOM, no Three.js — so main.js drives the flow
 * and the menu renders it. Everything persists through settings.js so a
 * player who reloads mid-cup carries on where they left off.
 */

export const CUP_LENGTH = 4;

/** Base AI skill per cup; each race within a cup adds a little on top. */
export const TIERS = [
  { name: 'Rookie Cup', skill: 0.50 },
  { name: 'Bronze Cup', skill: 0.62 },
  { name: 'Silver Cup', skill: 0.73 },
  { name: 'Gold Cup', skill: 0.84 },
  { name: 'Champion Cup', skill: 0.95 },
];

const POINTS = [10, 8, 6, 5, 4, 3, 2, 1];
const RACE_COINS = [100, 70, 50, 35, 25, 15, 10, 10, 10, 10];
const CUP_BONUS = [300, 200, 120, 60, 40, 30, 20, 20, 20, 20];

/** Race conditions rotate through a cup so back-to-back races look different. */
export const CONDITIONS = ['day', 'sunset', 'overcast', 'dusk'];
export const CONDITION_LABEL = { day: 'Midday', sunset: 'Sunset', overcast: 'Overcast', dusk: 'Dusk' };

export const UPGRADES = {
  engine: { label: 'Engine', blurb: '+6% power per level', costs: [150, 300, 500, 800, 1200] },
  grip: { label: 'Tyres', blurb: '+4% grip per level', costs: [150, 300, 500, 800, 1200] },
};
export const PAINT_COST = 400;

export const PLAYER_KEY = '__player';

export function tierOf(settings) {
  return TIERS[Math.min(settings.cupTier, TIERS.length - 1)];
}

/** Returns the cup in progress, starting a fresh one if there isn't one. */
export function currentCup(settings) {
  return settings.cup ?? { race: 0, points: {} };
}

export function conditionFor(cup) {
  return CONDITIONS[cup.race % CONDITIONS.length];
}

/**
 * AI skill for the next race. The Settings difficulty shifts the whole ladder
 * (normal = no shift) instead of capping it, so later cups still get harder.
 */
export function aiSkill(settings, chosenSkill) {
  const cup = currentCup(settings);
  const base = tierOf(settings).skill + 0.02 * cup.race;
  return Math.max(0.3, Math.min(1.1, base + (chosenSkill - 0.78)));
}

/** Multipliers applied to the player's car from garage upgrades. */
export function carBoost(settings) {
  return { power: 1 + 0.06 * settings.engineLvl, grip: 1 + 0.04 * settings.gripLvl };
}

export function upgradeCost(settings, kind) {
  const lvl = settings[`${kind}Lvl`];
  return UPGRADES[kind].costs[lvl] ?? null;   // null = maxed
}

/**
 * Scores a finished race. `order` is the race result, best first; each item
 * needs { name, isPlayer }. Returns what changed so the results screen can
 * show it, plus the settings patch to save.
 */
export function scoreRace(settings, order) {
  const cup = currentCup(settings);
  const points = { ...cup.points };
  const gained = {};
  order.forEach((e, i) => {
    const key = e.isPlayer ? PLAYER_KEY : e.name;
    gained[key] = POINTS[i] ?? 0;
    points[key] = (points[key] ?? 0) + gained[key];
  });

  const playerPos = order.findIndex((e) => e.isPlayer) + 1;
  const raceCoins = RACE_COINS[playerPos - 1] ?? 0;
  const raceNumber = cup.race + 1;
  const standings = Object.entries(points)
    .map(([key, pts]) => ({ key, pts, gained: gained[key] ?? 0 }))
    .sort((a, b) => b.pts - a.pts || (a.key === PLAYER_KEY ? -1 : 1));

  const cupOver = raceNumber >= CUP_LENGTH;
  const cupPos = standings.findIndex((s) => s.key === PLAYER_KEY) + 1;
  const tierMult = 1 + 0.5 * Math.min(settings.cupTier, TIERS.length - 1);
  const cupBonus = cupOver ? Math.round((CUP_BONUS[cupPos - 1] ?? 0) * tierMult) : 0;
  const promoted = cupOver && cupPos <= 3 && settings.cupTier < TIERS.length - 1;

  const patch = {
    coins: settings.coins + raceCoins + cupBonus,
    cup: cupOver ? null : { race: raceNumber, points },
    cupTier: promoted ? settings.cupTier + 1 : settings.cupTier,
  };

  return {
    tierName: tierOf(settings).name, raceNumber, playerPos, raceCoins,
    standings, cupOver, cupPos, cupBonus, promoted,
    nextTierName: promoted ? TIERS[settings.cupTier + 1].name : null,
    patch,
  };
}
