import { supabase } from './supabase.js';

// Unambiguous alphabet: no 0/O or 1/I so room codes are easy to read aloud.
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomCode(len = 4) {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

/**
 * One Supabase Realtime channel per race room. Presence is the player
 * roster; the player with the earliest `online_at` is host (re-elected
 * automatically whenever the roster changes, e.g. the host disconnects).
 * Broadcast carries: settings (host -> all), start (host -> all), state
 * (every client, ~10Hz), finish (a client announcing it crossed the line).
 */
export class Lobby {
  constructor({ code, name, color, onRoster, onSettings, onStart, onState, onFinish, onHostChange }) {
    this.code = code;
    this.clientId = crypto.randomUUID();
    this.name = name;
    this.color = color;
    this.onRoster = onRoster;
    this.onSettings = onSettings;
    this.onStart = onStart;
    this.onState = onState;
    this.onFinish = onFinish;
    this.onHostChange = onHostChange;
    this.isHost = false;
    this.hostId = null;
    this.channel = null;
    this.connected = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.channel = supabase.channel(`race:${this.code}`, {
        config: { presence: { key: this.clientId }, broadcast: { self: false } },
      });

      this.channel
        .on('presence', { event: 'sync' }, () => this._onPresenceSync())
        .on('presence', { event: 'join' }, () => this._onPresenceSync())
        .on('presence', { event: 'leave' }, () => this._onPresenceSync())
        .on('broadcast', { event: 'settings' }, ({ payload }) => this.onSettings?.(payload))
        .on('broadcast', { event: 'start' }, ({ payload }) => this.onStart?.(payload))
        .on('broadcast', { event: 'state' }, ({ payload }) => this.onState?.(payload))
        .on('broadcast', { event: 'finish' }, ({ payload }) => this.onFinish?.(payload))
        .subscribe(async (status, err) => {
          if (status === 'SUBSCRIBED') {
            await this.channel.track({
              name: this.name,
              color: this.color,
              online_at: new Date().toISOString(),
            });
            this.connected = true;
            resolve(this);
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            reject(err || new Error(`Lobby channel ${status}`));
          }
        });
    });
  }

  _onPresenceSync() {
    const state = this.channel.presenceState();
    const roster = [];
    for (const key of Object.keys(state)) {
      const presences = state[key];
      if (!presences || !presences.length) continue;
      const p = presences[0];
      roster.push({ clientId: key, name: p.name, color: p.color, onlineAt: p.online_at });
    }
    roster.sort((a, b) => (a.onlineAt < b.onlineAt ? -1 : a.onlineAt > b.onlineAt ? 1 : 0));
    const hostId = roster[0]?.clientId ?? null;
    const wasHost = this.isHost;
    this.hostId = hostId;
    this.isHost = hostId === this.clientId;
    if (this.isHost !== wasHost) this.onHostChange?.(this.isHost);
    this.onRoster?.(roster, hostId);
  }

  sendSettings(settings) {
    this.channel?.send({ type: 'broadcast', event: 'settings', payload: { settings } });
  }

  /** grid: [{ clientId, slotIndex }], aiProfiles for the AI-filled slots. */
  sendStart({ settings, grid, aiProfiles, countdown }) {
    this.channel?.send({
      type: 'broadcast', event: 'start',
      payload: { settings, grid, aiProfiles, countdown, sentAt: performance.now() / 1000 },
    });
  }

  sendState(car, extra = {}) {
    this.channel?.send({
      type: 'broadcast', event: 'state',
      payload: { clientId: this.clientId, t: performance.now() / 1000, car, ...extra },
    });
  }

  sendFinish(payload) {
    this.channel?.send({
      type: 'broadcast', event: 'finish',
      payload: { clientId: this.clientId, ...payload },
    });
  }

  async leave() {
    if (!this.channel) return;
    try { await this.channel.untrack(); } catch { /* already disconnected */ }
    supabase.removeChannel(this.channel);
    this.channel = null;
    this.connected = false;
  }
}
