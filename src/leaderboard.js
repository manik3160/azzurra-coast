import { supabase, isConfigured } from './net/supabase.js';

const TRACK = 'azzurra-coast';

export function leaderboardEnabled() {
  return isConfigured;
}

/** lapMs must be a single lap time (the "best lap" this session), in milliseconds. */
export async function submitLapTime({ playerName, lapMs, laps, aiCount, tc, abs }) {
  if (!isConfigured) return { error: 'Leaderboard is not configured.' };
  const assists = `${tc ? 'TC' : 'tc'}/${abs ? 'ABS' : 'abs'}`;
  const { error } = await supabase.from('lap_times').insert({
    player_name: (playerName || 'Driver').slice(0, 24),
    lap_ms: Math.round(lapMs),
    track: TRACK,
    laps,
    ai_count: aiCount,
    assists,
  });
  return { error: error?.message ?? null };
}

export async function fetchTopTimes(limit = 20) {
  if (!isConfigured) return { rows: [], error: 'Leaderboard is not configured.' };
  const { data, error } = await supabase
    .from('lap_times')
    .select('player_name, lap_ms, ai_count, assists, created_at')
    .eq('track', TRACK)
    .order('lap_ms', { ascending: true })
    .limit(limit);
  return { rows: data ?? [], error: error?.message ?? null };
}
