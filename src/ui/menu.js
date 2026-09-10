import { formatTime } from '../race.js';

const SKILLS = ['easy', 'normal', 'hard', 'pro'];
const QUALITIES = ['low', 'medium', 'high'];
const COLORS = [0xb6e832, 0xe0472c, 0x2f7fd8, 0xe0872a, 0xc9337a, 0x3fa7a0, 0xf3d33a, 0xffffff];

/**
 * Manages every pre-race / out-of-race screen (menu, settings, multiplayer
 * join/host, lobby, leaderboard) inside a single overlay panel. Rendering is
 * cheap (small DOM) so each screen is just rebuilt from a template string.
 */
export class Menu {
  constructor({ root, panel, settings, netAvailable, handlers }) {
    this.root = root;
    this.panel = panel;
    this.settings = settings;
    this.netAvailable = netAvailable;
    this.h = handlers;
  }

  show() { this.root.classList.remove('hidden'); }
  hide() { this.root.classList.add('hidden'); }

  showMain() {
    this.show();
    this.panel.innerHTML = `
      <div class="eyebrow">Circuit</div>
      <h1>Azzurra Coast</h1>
      <p class="lede">${this.settings.laps} lap${this.settings.laps > 1 ? 's' : ''} · ${this.settings.aiCount} AI · rear-wheel drive</p>
      <div class="menu-list">
        <button class="btn" data-a="single">${__POKI__ ? 'Race' : 'Single Player'}</button>
        ${__POKI__ ? '' : `
          <button class="btn ghost" data-a="mp" ${this.netAvailable ? '' : 'disabled'}>Multiplayer</button>
          <button class="btn ghost" data-a="board" ${this.netAvailable ? '' : 'disabled'}>Leaderboard</button>`}
        <button class="btn ghost" data-a="settings">Settings</button>
      </div>
      ${__POKI__ || this.netAvailable ? '' : '<div class="hint">Multiplayer &amp; leaderboard need Supabase env vars — see README.</div>'}
    `;
    this._bind({
      single: () => this.h.onSingleStart(),
      mp: () => this.showMultiplayerChoice(),
      board: () => this.h.onOpenLeaderboard(),
      settings: () => this.showSettings(),
    });
  }

  showSettings(backTo = 'main') {
    this.show();
    const s = this.settings;
    this.panel.innerHTML = `
      <div class="eyebrow">Setup</div>
      <h1>Settings</h1>
      <div class="form">
        <label>Driver name
          <input id="fName" type="text" maxlength="16" value="${escapeAttr(s.playerName)}" />
        </label>
        <label>Laps <span class="val" id="lapsVal">${s.laps}</span>
          <input id="fLaps" type="range" min="1" max="10" value="${s.laps}" />
        </label>
        <label>AI opponents <span class="val" id="aiVal">${s.aiCount}</span>
          <input id="fAi" type="range" min="0" max="9" value="${s.aiCount}" />
        </label>
        <label>AI difficulty
          <select id="fSkill">${opts(SKILLS, s.aiSkill)}</select>
        </label>
        <label>Car colour
          <div class="swatches" id="fColor">
            ${COLORS.map((c) => `<button class="swatch-btn ${c === s.carColor ? 'sel' : ''}" data-c="${c}" style="background:#${c.toString(16).padStart(6, '0')}"></button>`).join('')}
          </div>
        </label>
        <label class="row"><input id="fTc" type="checkbox" ${s.tc ? 'checked' : ''} /> Traction control</label>
        <label class="row"><input id="fAbs" type="checkbox" ${s.abs ? 'checked' : ''} /> ABS</label>
        <label>Graphics quality
          <select id="fQuality">${opts(QUALITIES, s.quality)}</select>
        </label>
      </div>
      <button class="btn" data-a="save">Save</button>
      <button class="btn ghost" data-a="back">Back</button>
    `;
    const $ = (id) => this.panel.querySelector(id);
    $('#fLaps').oninput = (e) => { $('#lapsVal').textContent = e.target.value; };
    $('#fAi').oninput = (e) => { $('#aiVal').textContent = e.target.value; };
    $('#fColor').onclick = (e) => {
      const btn = e.target.closest('.swatch-btn');
      if (!btn) return;
      this.panel.querySelectorAll('.swatch-btn').forEach((b) => b.classList.remove('sel'));
      btn.classList.add('sel');
    };
    this._bind({
      save: () => {
        const selSwatch = this.panel.querySelector('.swatch-btn.sel');
        this.h.onSettingsSave({
          playerName: $('#fName').value.trim() || this.settings.playerName,
          laps: Number($('#fLaps').value),
          aiCount: Number($('#fAi').value),
          aiSkill: $('#fSkill').value,
          carColor: selSwatch ? Number(selSwatch.dataset.c) : this.settings.carColor,
          tc: $('#fTc').checked,
          abs: $('#fAbs').checked,
          quality: $('#fQuality').value,
        });
        backTo === 'lobby' ? this.h.onOpenMultiplayer() : this.showMain();
      },
      back: () => (backTo === 'lobby' ? this.h.onOpenMultiplayer() : this.showMain()),
    });
  }

  showMultiplayerChoice(error) {
    this.show();
    this.panel.innerHTML = `
      <div class="eyebrow">Multiplayer</div>
      <h1>Race with friends</h1>
      <p class="lede">Host a lobby, or join one with a room code.</p>
      ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
      <div class="form">
        <label>Your name
          <input id="fName" type="text" maxlength="16" value="${escapeAttr(this.settings.playerName)}" />
        </label>
      </div>
      <button class="btn" data-a="host">Host a Lobby</button>
      <div class="form" style="margin-top:14px">
        <label>Room code
          <input id="fCode" type="text" maxlength="4" placeholder="ABCD" style="text-transform:uppercase;letter-spacing:.3em;text-align:center" />
        </label>
      </div>
      <button class="btn ghost" data-a="join">Join</button>
      <button class="btn ghost" data-a="back">Back</button>
    `;
    const $ = (id) => this.panel.querySelector(id);
    this._bind({
      host: () => this.h.onHost({ playerName: $('#fName').value.trim() || this.settings.playerName }),
      join: () => this.h.onJoin($('#fCode').value.trim().toUpperCase(), { playerName: $('#fName').value.trim() || this.settings.playerName }),
      back: () => this.showMain(),
    });
  }

  showLobbyConnecting(label) {
    this.show();
    this.panel.innerHTML = `
      <div class="eyebrow">Multiplayer</div>
      <h1>${escapeHtml(label)}</h1>
      <p class="lede">Connecting…</p>
      <button class="btn ghost" data-a="back">Cancel</button>
    `;
    this._bind({ back: () => this.h.onLeaveLobby() });
  }

  showLobby({ code, roster, isHost, settings, starting }) {
    this.show();
    const s = settings;
    const rows = roster.map((r) => `
      <li class="${r.isHost ? 'host' : ''}">
        <span class="swatch" style="background:#${(r.color >>> 0).toString(16).padStart(6, '0')}"></span>
        ${escapeHtml(r.name)} ${r.isHost ? '<em>· host</em>' : ''}
      </li>`).join('');
    this.panel.innerHTML = `
      <div class="eyebrow">Lobby</div>
      <h1>Code <span class="code">${code}</span></h1>
      <p class="lede">Share the code — friends join from Multiplayer → Join.</p>
      <ul class="roster">${rows}</ul>
      ${isHost ? `
        <div class="form">
          <label>Laps <span class="val" id="lapsVal">${s.laps}</span>
            <input id="fLaps" type="range" min="1" max="10" value="${s.laps}" />
          </label>
          <label>AI opponents (fills empty grid slots) <span class="val" id="aiVal">${s.aiCount}</span>
            <input id="fAi" type="range" min="0" max="9" value="${s.aiCount}" />
          </label>
        </div>
        <button class="btn" data-a="start" ${starting ? 'disabled' : ''}>${starting ? 'Starting…' : 'Start Race'}</button>
      ` : `<p class="lede">Waiting for the host to start…</p>`}
      <button class="btn ghost" data-a="leave">Leave Lobby</button>
    `;
    if (isHost) {
      const $ = (id) => this.panel.querySelector(id);
      $('#fLaps').oninput = (e) => { $('#lapsVal').textContent = e.target.value; this.h.onLobbySettingsChange({ laps: Number(e.target.value) }); };
      $('#fAi').oninput = (e) => { $('#aiVal').textContent = e.target.value; this.h.onLobbySettingsChange({ aiCount: Number(e.target.value) }); };
      this._bind({ start: () => this.h.onLobbyStart(), leave: () => this.h.onLeaveLobby() });
    } else {
      this._bind({ leave: () => this.h.onLeaveLobby() });
    }
  }

  showLeaderboard(rows, error) {
    this.show();
    const body = error
      ? `<p class="error">${escapeHtml(error)}</p>`
      : rows.length === 0
        ? `<p class="lede">No times yet — be the first.</p>`
        : `<table class="results">${rows.map((r, i) => `
            <tr><td>${i + 1}</td><td>${escapeHtml(r.player_name)}</td><td>${formatTime(r.lap_ms / 1000)}</td></tr>
          `).join('')}</table>`;
    this.panel.innerHTML = `
      <div class="eyebrow">Best laps · Azzurra Coast</div>
      <h1>Leaderboard</h1>
      ${body}
      <button class="btn ghost" data-a="back">Back</button>
    `;
    this._bind({ back: () => this.showMain() });
  }

  _bind(map) {
    this.panel.onclick = (e) => {
      const btn = e.target.closest('[data-a]');
      if (!btn || btn.disabled) return;
      map[btn.dataset.a]?.();
    };
  }
}

function opts(list, current) {
  return list.map((v) => `<option value="${v}" ${v === current ? 'selected' : ''}>${v}</option>`).join('');
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
