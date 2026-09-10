/**
 * Thin wrapper over the Poki SDK.
 *
 * The SDK is delivered by a script tag from Poki's CDN and is only present in
 * the Poki build, so every call here has to survive `window.PokiSDK` being
 * undefined — that's the normal case during local dev and on the Vercel build.
 * Ad-blockers can also stop the script loading on Poki itself, and games are
 * required to keep working in that case.
 *
 * Poki decides when a player is actually ready to see an ad, so the correct
 * behaviour is to signal every legitimate break opportunity and let the SDK
 * no-op the ones it doesn't want. Under-signalling means under-earning.
 */

const sdk = () => (typeof window !== 'undefined' ? window.PokiSDK : undefined);

// An ad that never settles would strand the player on a paused screen, so every
// break is raced against a ceiling. Real breaks finish well inside this.
const AD_TIMEOUT_MS = 20000;

let ready = false;
let inGameplay = false;   // guards against duplicate consecutive events
let inAd = false;         // no events may be fired while an ad is playing

function withTimeout(promise, fallback) {
  return Promise.race([
    Promise.resolve(promise),
    new Promise((resolve) => setTimeout(() => resolve(fallback), AD_TIMEOUT_MS)),
  ]);
}

export const pokiEnabled = __POKI__;

/** Resolves once the SDK is ready, or immediately if it isn't available. */
export async function initPoki() {
  const s = sdk();
  if (!s) return false;
  try {
    await s.init();
    ready = true;
    return true;
  } catch {
    // "Initialized, something went wrong, load your game anyway"
    return false;
  }
}

/** Call once the game is actually playable (assets built, first frame ready). */
export function loadingFinished() {
  if (ready) sdk()?.gameLoadingFinished?.();
}

/** Player has started actually interacting with the game. */
export function gameplayStart() {
  if (!ready || inGameplay || inAd) return;
  inGameplay = true;
  sdk()?.gameplayStart?.();
}

/** Gameplay halted: pause, race finished, returned to menu. */
export function gameplayStop() {
  if (!ready || !inGameplay || inAd) return;
  inGameplay = false;
  sdk()?.gameplayStop?.();
}

/**
 * A natural break — call before returning the player to gameplay.
 * Resolves whether or not an ad actually played, so the caller can always
 * continue straight into the race.
 */
export async function commercialBreak(onStart) {
  const s = sdk();
  if (!ready || !s?.commercialBreak) return;
  gameplayStop();
  inAd = true;
  try {
    await withTimeout(
      s.commercialBreak(() => { try { onStart?.(); } catch { /* audio pause is best-effort */ } }),
      undefined,
    );
  } catch {
    // an ad failing must never block the game
  } finally {
    inAd = false;
  }
}

/**
 * Optional ad the player opts into for a reward.
 * Resolves true only when the video was actually completed.
 */
export async function rewardedBreak(onStart) {
  const s = sdk();
  if (!ready || !s?.rewardedBreak) return false;
  gameplayStop();
  inAd = true;
  try {
    return (await withTimeout(
      s.rewardedBreak(() => { try { onStart?.(); } catch { /* best-effort */ } }),
      false,
    )) === true;
  } catch {
    return false;
  } finally {
    inAd = false;
  }
}

/** True when a rewarded ad could plausibly be offered. */
export function canOfferReward() {
  return ready && typeof sdk()?.rewardedBreak === 'function';
}
