import * as THREE from 'three';

/**
 * Follows the precomputed racing line with a lookahead point, brakes for
 * upcoming curvature, and nudges sideways to avoid the car in front.
 */
export class AIDriver {
  constructor(vehicle, track, profile) {
    this.v = vehicle;
    this.track = track;
    this.skill = profile.skill;              // 0..1
    this.offset = profile.offset;            // metres left/right of the line
    this.noiseSeed = Math.random() * 100;
    this.prevErr = 0;
  }

  control(dt, idx, time, others) {
    const { line, center, normal, samples } = this.track;
    const v = this.v;
    const pos = v.position;
    const speed = v.speedKmh / 3.6;

    const step = center[0].distanceTo(center[1]);
    const look = THREE.MathUtils.clamp(9 + speed * 0.78, 10, 46);
    const ahead = (idx + Math.round(look / step)) % samples;

    const wobble = Math.sin(time * 0.7 + this.noiseSeed) * 0.9 * (1 - this.skill);
    const lat = this.offset + wobble + this.avoidance(others, idx);
    const targetPt = line[ahead].clone().addScaledVector(normal[ahead], lat);

    // --- steering (PD on heading error) ---
    const fwd = v.forward;
    const to = targetPt.clone().sub(pos);
    to.y = 0;
    const err = Math.atan2(
      fwd.x * to.z - fwd.z * to.x,
      fwd.x * to.x + fwd.z * to.z
    );
    const d = (err - this.prevErr) / Math.max(dt, 1e-3);
    this.prevErr = err;
    const steer = THREE.MathUtils.clamp(-(err * 1.75 + d * 0.09), -1, 1);

    // --- speed target: fastest speed we can still brake down from ---
    const mu = 1.46 + this.skill * 0.30;
    const aBrake = 9.5 + this.skill * 3.0;          // m/s^2 the driver trusts
    const horizon = Math.round(300 / step);
    let vMax = 20 + this.skill * 52;                 // straight-line ambition
    for (let i = 3; i < horizon; i++) {
      const k = Math.abs(this.track.curvature[(idx + i) % samples]);
      const vCorner = k > 1e-4 ? Math.sqrt((mu * 9.81) / k) : 95;
      const d = i * step;
      vMax = Math.min(vMax, Math.sqrt(vCorner * vCorner + 2 * aBrake * d));
    }
    if (v.offRoad) vMax = Math.min(vMax, 24);

    let throttle = 0, brake = 0;
    if (speed < vMax - 1.5) throttle = THREE.MathUtils.clamp((vMax - speed) / 6, 0.35, 1);
    else if (speed > vMax + 2.5) brake = THREE.MathUtils.clamp((speed - vMax) / 9, 0.2, 1);
    else throttle = 0.32;

    // don't floor it while pointing badly off line
    throttle *= 1 - Math.min(0.32, Math.abs(steer) * 0.34);

    return { throttle, brake, steer, handbrake: false };
  }

  avoidance(others, idx) {
    const v = this.v;
    const pos = v.position;
    const fwd = v.forward;
    let push = 0;
    for (const o of others) {
      if (o === v) continue;
      const rel = o.position.clone().sub(pos);
      const dist = rel.length();
      if (dist > 16) continue;
      const ahead = rel.dot(fwd);
      if (ahead < 1 || ahead > 15) continue;
      const side = rel.dot(new THREE.Vector3(1, 0, 0).applyQuaternion(v.quaternion));
      push += (side > 0 ? -1 : 1) * (16 - dist) * 0.42;
    }
    return THREE.MathUtils.clamp(push, -3.2, 3.2);
  }
}

// Base roster (name, paint, accent) — skill and offset are generated per race
// so the same drivers can be used at any difficulty and any grid size.
const ROSTER = [
  { name: 'Vero',     color: 0xd8422c, accent: 0xffd9a0 },
  { name: 'Ferrand',  color: 0x8b3f9e, accent: 0xe9c6ff },
  { name: 'Kovac',    color: 0x2f7fd8, accent: 0xbfe1ff },
  { name: 'Sandoval', color: 0x1d8f6a, accent: 0xb9f0d8 },
  { name: 'Mireau',   color: 0xe0872a, accent: 0xfff0cf },
  { name: 'Okafor',   color: 0xc9337a, accent: 0xffd2e6 },
  { name: 'Lindqvist',color: 0x3fa7a0, accent: 0xcdf3ef },
  { name: 'Basile',   color: 0x9a8b2f, accent: 0xf3ecc0 },
  { name: 'Renner',   color: 0x5a6bd8, accent: 0xd8dfff },
];

const OFFSETS = [-1.0, 1.2, -1.9, 1.9, 0.1, -2.6, 2.6, -0.6, 0.6];

/**
 * Builds `count` AI profiles at the given base skill (0..~1). Each driver
 * gets a small deterministic-ish spread around that skill so a grid never
 * feels robotic, and a side-offset from OFFSETS so they don't all queue up
 * on the racing line.
 */
export function makeProfiles(count, baseSkill) {
  const n = Math.max(0, Math.min(ROSTER.length, count));
  const out = [];
  for (let i = 0; i < n; i++) {
    const spread = ((i * 37) % 11) / 11 - 0.5; // -0.5..0.5, deterministic per slot
    const skill = Math.max(0.05, Math.min(1.05, baseSkill + spread * 0.14));
    out.push({ ...ROSTER[i], skill, offset: OFFSETS[i % OFFSETS.length] });
  }
  return out;
}
