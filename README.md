# Azzurra Coast — browser 3D racing game

Low-poly arcade racer built with **Three.js** for rendering and **Rapier** (WASM) for rigid-body
physics. Six cars, three laps, a hand-built circuit.

## Run

```bash
npm install
npm run dev     # http://localhost:5180
```

`npm run build` produces a static `dist/` you can host anywhere.

## Controls

| Key | Action |
| --- | --- |
| `W` / `S` | throttle / brake (hold `S` at a standstill to reverse) |
| `A` / `D` | steer |
| `Space` | handbrake (kills rear grip — use it to rotate the car) |
| `R` | reset to the racing line |
| `C` | camera: chase → hood → orbit |
| `Esc` | pause / resume |

Add `?debug` to the URL to expose `window.__game` (world, track, race, `step(dt)`, `sim(seconds)`,
`setControls(...)`) for scripted testing.

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
  friction circle — which is what makes the car understeer, get wheelspin and drift. Six-speed
  auto box with a torque curve, aero drag and downforce.
- **`src/ai.js`** — each opponent aims at a lookahead point on the racing line (PD steering) and sets
  its speed from the tightest corner within 300 m, using `v² = v_corner² + 2·a·d` so it runs flat out
  on the straight and brakes at the right moment. Small per-driver skill, line offsets and a
  side-stepping avoidance term keep the pack racing rather than queuing.
- **`src/race.js`** — tracks each car's nearest centreline sample, counts laps on a forward crossing
  of index 0, and sorts live positions by `lap × samples + index`.
- Cars that flip or beach themselves on a barrier are automatically returned to the racing line.

## Files

```
src/main.js       bootstrap, fixed-timestep loop, race flow (countdown → race → results)
src/track.js      spline circuit, road/kerb/guardrail meshes + colliders, racing line
src/scenery.js    instanced conifers, rocks, distant hills, gradient sky
src/vehicle.js    Rapier raycast vehicle: suspension, tyre model, gearbox, aero
src/carModel.js   chunky low-poly car built from boxes
src/ai.js         opponent drivers
src/race.js       laps, timing, live positions, grid slots
src/camera.js     chase / hood / orbit cameras
src/hud.js        HUD bindings   src/minimap.js  canvas minimap
src/input.js      keyboard      src/styles.css   HUD styling
```
