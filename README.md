# Azzurra Coast — browser 3D racing game

Low-poly arcade racer built with **Three.js** for rendering and **Rapier** (WASM) for rigid-body
physics, with optional live multiplayer and a leaderboard via **Supabase**. Configurable laps, AI
count/difficulty, assists, and graphics quality.

## Run

```bash
npm install
npm run dev     # http://localhost:5180
```

`npm run build` produces a static `dist/` you can host anywhere. Single-player works with zero
configuration; multiplayer and the leaderboard need Supabase (see below) and degrade gracefully —
those two menu buttons are simply disabled — if it isn't configured.

## Controls

| Key | Action |
| --- | --- |
| `W` / `S` | throttle / brake (hold `S` at a standstill to reverse) |
| `A` / `D` | steer |
| `Space` | handbrake (kills rear grip — use it to rotate the car) |
| `R` | reset to the racing line |
| `C` | camera: chase → hood → orbit |
| `Esc` | pause / resume |

Add `?debug` to the URL to expose `window.__game` (`track`, `race`, `entries`, `player`, `step(dt)`,
`sim(seconds)`, `setControls(...)`, `start()`) for scripted testing.

## Multiplayer & leaderboard setup (Supabase)

Everything runs from one free Supabase project — Realtime channels carry the race, Postgres holds
the leaderboard, and the whole app stays a static Vite build (no Vercel Functions needed).

1. **Create the project.** Easiest from a Vercel-linked repo: `vercel integration add supabase`
   (this needs `vercel link` first and a one-time terms acceptance in the browser). Otherwise create
   a project directly at [supabase.com](https://supabase.com).
2. **Apply the schema** — run [`supabase/schema.sql`](supabase/schema.sql) once in the project's SQL
   editor (or `psql "$POSTGRES_URL_NON_POOLING" -f supabase/schema.sql` if you have the connection
   string). It creates the `lap_times` table with row-level security: anyone can `select`/`insert`,
   nobody can `update`/`delete` — the table is append-only from the browser.
3. **Set the env vars.** The app reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (the
   `VITE_` prefix is required for Vite to expose them to client code). If you used the Vercel
   Supabase integration, it provisions `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` (Next.js-style
   names) instead — copy those values into `VITE_`-prefixed vars locally in `.env.local` and on
   Vercel (`vercel env add VITE_SUPABASE_URL <env>`, same for the key, for each of
   production/preview/development), then redeploy.

Realtime state syncs at **10Hz per client** (`NET_HZ` in `src/main.js`) — a full 6-car lobby sends
roughly 60-70 messages/sec, comfortably under Supabase Free's 100 msg/sec project-wide quota. Lower
`NET_HZ` if you expect multiple simultaneous lobbies.

## How it works

- **`src/track.js`** — the circuit is a closed Catmull-Rom spline through hand-placed control points,
  sampled at even arc length. From those samples it extrudes the road ribbon, alternating red/white
  kerbs, edge lines, centre dashes, the sand run-off and the guardrails (which get one thin cuboid
  collider per segment). It also derives the racing line by pulling the centreline toward the apexes
  and smoothing.
- **`src/vehicle.js`** — a raycast vehicle on top of a single Rapier dynamic body. Each wheel casts a
  ray down every substep; the hit gives suspension compression → spring/damper force, plus an
  anti-roll bar between each axle pair. Tyre forces are split into lateral (an impulse that cancels
  sideways velocity) and longitudinal (engine torque, brakes, rolling resistance), then clipped to a
  friction circle — which is what makes the car understeer, get wheelspin and drift. TC/ABS toggles
  change which axis that clip sacrifices first (lateral vs. longitudinal). Six-speed auto box with a
  torque curve, aero drag and downforce.
- **`src/ai.js`** — each opponent aims at a lookahead point on the racing line (PD steering) and sets
  its speed from the tightest corner within 300 m, using `v² = v_corner² + 2·a·d` so it runs flat out
  on the straight and brakes at the right moment. `makeProfiles(count, skill)` generates the grid at
  whatever size/difficulty settings ask for.
- **`src/race.js`** — tracks each car's nearest centreline sample, counts laps on a forward crossing
  of index 0, and sorts live positions by `lap × samples + index`. For networked cars this state is
  taken from the network rather than recomputed (see below).
- Cars that flip or beach themselves on a barrier are automatically returned to the racing line
  (local cars only — a remote car's own machine handles its own recovery).

### Multiplayer model

Each client simulates **only its own car** with full Rapier physics — no input lag, no cross-client
physics divergence. Every other car is a **kinematic, interpolated** `RemoteVehicle`
(`src/remoteVehicle.js`): it still collides with your car, but can't be shoved off-line, since it's
just replaying network snapshots (rendered ~100ms behind, with hermite-ish lerp/slerp between the two
bracketing snapshots and short extrapolation on packet loss).

The **host** simulates its own car *and* all AI, broadcasting a single batched message per tick; a
**guest** simulates only itself and receives everyone else — including the AI — as `RemoteVehicle`s.
Lap counts and finish state are **owner-authoritative**: whoever's machine is actually simulating a
car reports its lap/finish/best-lap fields over the network, and `Race` mirrors those for entries it
doesn't own rather than recomputing them from position (`src/race.js`, the `isRemote` branch).

`src/net/lobby.js` wraps one Supabase Realtime channel per room: presence is the player roster (the
earliest joiner is host, re-elected automatically if they leave), and broadcast events carry
`settings`, `start` (grid assignment), `state` (10Hz transforms), and `finish`.

**Honest limitations:** physics is client-authoritative, so lap times are cheatable by a determined
player — fine for racing friends, not a competitive ladder. Player-vs-player contact is a little soft
since remotes are interpolated. If the host disconnects mid-race, the AI cars they were simulating
freeze in place for everyone else (no host migration mid-race, only in the lobby).

## Files

```
src/main.js          bootstrap, fixed-timestep loop, session lifecycle, race flow
src/settings.js       persisted settings (laps, AI, assists, quality, name/colour)
src/track.js          spline circuit, road/kerb/guardrail meshes + colliders, racing line
src/scenery.js         instanced conifers, rocks, distant hills, gradient sky
src/vehicle.js         Rapier raycast vehicle: suspension, tyre model, gearbox, aero, TC/ABS
src/remoteVehicle.js   kinematic, network-interpolated car (multiplayer only)
src/carModel.js        chunky low-poly car built from boxes
src/ai.js              opponent driver logic + profile generator
src/race.js            laps, timing, live positions, grid slots
src/camera.js          chase / hood / orbit cameras
src/hud.js             HUD bindings          src/minimap.js   canvas minimap
src/input.js           keyboard              src/styles.css   all UI styling
src/ui/menu.js          menu / settings / lobby / leaderboard screens
src/net/supabase.js     Supabase client singleton (null if unconfigured)
src/net/lobby.js        Realtime room: presence roster + broadcast events
src/net/snapshot.js     compact car-state pack for the wire
src/leaderboard.js      submit / fetch best lap times
supabase/schema.sql     leaderboard table + row-level security policies
```
