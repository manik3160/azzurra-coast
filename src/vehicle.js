import * as THREE from 'three';
import { createCarModel } from './carModel.js';

const RADIUS = 0.36;
const REST = 0.28;
const ATTACH_Y = -0.10;
const HALF_TRACK = 0.86;
const FRONT_Z = 1.37;
const REAR_Z = -1.42;
const VISUAL_DROP = 0.74;          // body origin -> ground in local space

// Shared with remoteVehicle.js so networked cars line up visually with local ones.
export const GEOMETRY = { RADIUS, REST, ATTACH_Y, HALF_TRACK, FRONT_Z, REAR_Z, VISUAL_DROP };

const SPRING = 62000;              // N/m
const DAMPER = 4200;               // N/(m/s)
const ANTIROLL = 26000;            // N/m of left/right travel difference
const MASS = 1250;                 // kg (set through collider density)

const GEARS = [3.55, 2.42, 1.82, 1.42, 1.15, 0.94];
const FINAL = 3.42;
const SHIFT_UP = 7100;
const SHIFT_DOWN = 3050;
const REDLINE = 7800;
const IDLE = 900;

// Peak ~555 Nm around 5200 rpm.
function engineTorque(rpm) {
  const r = THREE.MathUtils.clamp(rpm, IDLE, REDLINE);
  const t = 255 + 300 * Math.sin(Math.PI * THREE.MathUtils.clamp((r - 700) / 7000, 0, 1));
  return r > 7300 ? t * (1 - (r - 7300) / 900) : t;
}

const RAY_FILTER = 0x00010001;     // ray is in group 1, only collides with group 1 (the world)

export class Vehicle {
  constructor(ctx, opts) {
    const { world, RAPIER, scene } = ctx;
    this.world = world;
    this.RAPIER = RAPIER;
    this.name = opts.name || 'Driver';
    this.color = opts.color ?? 0xc8f527;
    this.isPlayer = !!opts.isPlayer;
    this.tc = opts.tc !== false;
    this.abs = opts.abs !== false;

    const yaw = opts.heading || 0;
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(opts.position.x, opts.position.y, opts.position.z)
      .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
      .setLinearDamping(0.05)
      .setAngularDamping(0.6)
      .setCanSleep(false);
    this.body = world.createRigidBody(desc);

    const half = { x: 0.92, y: 0.40, z: 2.12 };
    const density = MASS / (half.x * 2 * half.y * 2 * half.z * 2);
    const col = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
      .setTranslation(0, -0.16, 0)
      .setDensity(density)
      .setFriction(0.35)
      .setRestitution(0.1);
    col.setCollisionGroups(0x0002ffff);
    this.collider = world.createCollider(col, this.body);
    this.mass = this.body.mass() || MASS;

    // wheels: FL, FR, RL, RR
    this.wheels = [
      { local: new THREE.Vector3(-HALF_TRACK, ATTACH_Y, FRONT_Z), steered: true, drive: false },
      { local: new THREE.Vector3(HALF_TRACK, ATTACH_Y, FRONT_Z), steered: true, drive: false },
      { local: new THREE.Vector3(-HALF_TRACK, ATTACH_Y, REAR_Z), steered: false, drive: true },
      { local: new THREE.Vector3(HALF_TRACK, ATTACH_Y, REAR_Z), steered: false, drive: true },
    ].map((w) => ({ ...w, susp: REST, prevSusp: REST, grounded: false, load: 0, slip: 0, spin: 0, onRoad: true }));

    const model = createCarModel(this.color, opts.accent);
    this.mesh = model.group;
    this.wheelMeshes = model.wheels;
    scene.add(this.mesh);

    this.steer = 0;
    this.gear = 1;
    this.rpm = IDLE;
    this.shiftTimer = 0;
    this.reverse = false;
    this.speedKmh = 0;
    this.driftAmount = 0;
    this.offRoad = false;

    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
  }

  get position() {
    const t = this.body.translation();
    return this._v.set(t.x, t.y, t.z);
  }

  get quaternion() {
    const r = this.body.rotation();
    return this._q.set(r.x, r.y, r.z, r.w);
  }

  get forward() {
    return new THREE.Vector3(0, 0, 1).applyQuaternion(this.quaternion);
  }

  setAssists({ tc, abs } = {}) {
    if (tc !== undefined) this.tc = tc;
    if (abs !== undefined) this.abs = abs;
  }

  resetTo(pos, yaw) {
    this.body.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
    this.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.gear = 1;
    this.rpm = IDLE;
    this.steer = 0;
  }

  dispose() {
    this.world.removeRigidBody(this.body);
    this.mesh.parent?.remove(this.mesh);
  }

  /** ctrl: { throttle 0..1, brake 0..1, steer -1..1, handbrake bool } */
  update(dt, ctrl, surface) {
    const { RAPIER, world, body } = this;
    const q = this.quaternion;
    const pos = this.position.clone();

    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);

    const lv = body.linvel();
    const av = body.angvel();
    const linvel = new THREE.Vector3(lv.x, lv.y, lv.z);
    const angvel = new THREE.Vector3(av.x, av.y, av.z);
    const comRaw = body.worldCom ? body.worldCom() : body.translation();
    const com = new THREE.Vector3(comRaw.x, comRaw.y, comRaw.z);

    const vForward = linvel.dot(fwd);
    const vLateral = linvel.dot(right);
    const speed = linvel.length();
    this.speedKmh = Math.abs(vForward) * 3.6;

    // ---- steering ----
    const maxSteer = 0.58 - 0.36 * THREE.MathUtils.clamp(Math.abs(vForward) / 62, 0, 1);
    const target = ctrl.steer * maxSteer;
    const rate = (Math.abs(target) > Math.abs(this.steer) ? 5.5 : 9.0) * dt;
    this.steer += THREE.MathUtils.clamp(target - this.steer, -rate, rate);

    // ---- gearbox ----
    this.shiftTimer = Math.max(0, this.shiftTimer - dt);
    const wheelRpm = (Math.abs(vForward) / (2 * Math.PI * RADIUS)) * 60;
    this.reverse = vForward < 0.6 && ctrl.brake > 0.4 && ctrl.throttle < 0.05;
    if (this.reverse) {
      this.gear = 0;
      this.rpm = THREE.MathUtils.clamp(wheelRpm * GEARS[0] * FINAL, IDLE, 5200);
    } else {
      if (this.gear < 1) this.gear = 1;
      this.rpm = THREE.MathUtils.clamp(wheelRpm * GEARS[this.gear - 1] * FINAL, IDLE, REDLINE);
      if (!this.shiftTimer) {
        if (this.rpm > SHIFT_UP && this.gear < GEARS.length) { this.gear++; this.shiftTimer = 0.28; }
        else if (this.rpm < SHIFT_DOWN && this.gear > 1) { this.gear--; this.shiftTimer = 0.22; }
      }
    }

    const ratio = this.reverse ? -GEARS[0] * 0.8 : GEARS[this.gear - 1];
    const throttle = this.shiftTimer > 0.12 ? 0 : ctrl.throttle;
    const driveForce = (engineTorque(this.rpm) * Math.abs(ratio) * FINAL * 0.88 / RADIUS)
      * throttle * Math.sign(ratio || 1) / 2;

    const brakeForce = ctrl.brake * 9800;
    const massShare = this.mass / 4;

    // ---- pass 1: suspension raycasts ----
    const probe = [];
    let groundedCount = 0;
    const down = up.clone().multiplyScalar(-1);
    const maxToi = REST + RADIUS + 0.05;

    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      const attach = w.local.clone().applyQuaternion(q).add(pos);
      const ray = new RAPIER.Ray(
        { x: attach.x, y: attach.y, z: attach.z },
        { x: down.x, y: down.y, z: down.z }
      );
      const hit = world.castRay(ray, maxToi, true, undefined, RAY_FILTER, undefined, body);

      if (!hit) {
        w.grounded = false;
        w.load = 0;
        w.slip = 0;
        w.susp += (REST - w.susp) * Math.min(1, dt * 12);
        w.spin += (vForward / RADIUS) * dt;
        probe.push(null);
        continue;
      }
      groundedCount++;
      w.grounded = true;

      const dist = hit.timeOfImpact !== undefined ? hit.timeOfImpact : hit.toi;
      const susp = THREE.MathUtils.clamp(dist - RADIUS, 0, REST);
      w.susp = susp;

      const rel = attach.clone().sub(com);
      const vAttach = linvel.clone().add(new THREE.Vector3().crossVectors(angvel, rel));
      probe.push({
        attach,
        compression: REST - susp,
        rate: -vAttach.dot(up),
        contact: attach.clone().add(down.clone().multiplyScalar(susp + RADIUS)),
      });
    }

    // ---- anti-roll bars (front pair, rear pair) ----
    const arb = [0, 0, 0, 0];
    for (const [a, b] of [[0, 1], [2, 3]]) {
      if (!probe[a] || !probe[b]) continue;
      const f = ANTIROLL * (probe[a].compression - probe[b].compression);
      arb[a] = f;
      arb[b] = -f;
    }

    // ---- pass 2: suspension + tyre forces ----
    let maxSlip = 0;
    let onRoadCount = 0;

    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      const pr = probe[i];
      if (!pr) continue;

      let Fs = SPRING * pr.compression + DAMPER * pr.rate + arb[i];
      Fs = THREE.MathUtils.clamp(Fs, 0, 36000);
      w.load = Fs;

      body.applyImpulseAtPoint(
        { x: up.x * Fs * dt, y: up.y * Fs * dt, z: up.z * Fs * dt },
        { x: pr.attach.x, y: pr.attach.y, z: pr.attach.z },
        true
      );

      const contact = pr.contact;
      const isOnRoad = surface ? surface(contact) : true;
      w.onRoad = isOnRoad;
      if (isOnRoad) onRoadCount++;

      const st = w.steered ? this.steer : 0;
      const wFwd = fwd.clone().applyAxisAngle(up, st).normalize();
      const wRight = right.clone().applyAxisAngle(up, st).normalize();

      const relC = contact.clone().sub(com);
      const vC = linvel.clone().add(new THREE.Vector3().crossVectors(angvel, relC));
      const vf = vC.dot(wFwd);
      const vl = vC.dot(wRight);

      let mu = isOnRoad ? 1.62 : 0.66;
      const hb = ctrl.handbrake && !w.steered;
      if (hb) mu *= 0.55;
      const maxF = mu * Fs;

      let Flat = -vl * massShare / dt * 0.85;
      const latCap = maxF * 0.92;
      if (Math.abs(Flat) > latCap) { w.slip = Math.abs(Flat) / latCap; Flat = Math.sign(Flat) * latCap; }
      else w.slip = 0;
      maxSlip = Math.max(maxSlip, Math.min(w.slip, 3));

      let Flong = 0;
      if (w.drive && !hb) Flong += driveForce;
      const brakeHere = hb ? 4200 : brakeForce * (w.steered ? 0.58 : 0.42);
      if (brakeHere > 0) {
        Flong += -Math.sign(vf) * Math.min(brakeHere, Math.abs(vf) * massShare / dt);
      }
      Flong -= vf * 5.5;
      if (!isOnRoad) Flong -= vf * 26;

      const combined = Math.hypot(Flat, Flong);
      if (combined > maxF) {
        const braking = brakeHere > 0 && Math.abs(Flong) > Math.abs(Flat);
        const spinning = w.drive && !hb && Flong > 0 && Flong > Math.abs(Flat) * 0.3;
        if (this.abs && braking) {
          // ABS: sacrifice longitudinal (brake) force to keep steering grip.
          const availLong = Math.sqrt(Math.max(0, maxF * maxF - Flat * Flat));
          Flong = Math.sign(Flong) * Math.min(Math.abs(Flong), availLong);
        } else if (!this.tc && spinning) {
          // TC off: keep the requested drive force, let the tyre step out sideways.
          const availLat = Math.sqrt(Math.max(0, maxF * maxF - Flong * Flong));
          Flat = Math.sign(Flat) * Math.min(Math.abs(Flat), availLat);
        } else {
          const sc = maxF / combined;
          Flat *= sc; Flong *= sc;
        }
      }

      const imp = wFwd.clone().multiplyScalar(Flong * dt).add(wRight.clone().multiplyScalar(Flat * dt));
      body.applyImpulseAtPoint(
        { x: imp.x, y: imp.y, z: imp.z },
        { x: contact.x, y: contact.y, z: contact.z },
        true
      );

      w.spin += (vf / RADIUS) * dt;
    }

    this.grounded = groundedCount > 0;
    this.tilt = up.y;
    this.offRoad = groundedCount > 0 && onRoadCount < groundedCount * 0.5;
    this.driftAmount = THREE.MathUtils.clamp(Math.abs(vLateral) / 9, 0, 1) * (this.grounded ? 1 : 0);

    // ---- aero ----
    if (speed > 0.5) {
      const drag = linvel.clone().multiplyScalar(-0.34 * speed);
      body.applyImpulse({ x: drag.x * dt, y: drag.y * dt, z: drag.z * dt }, true);
    }
    if (groundedCount > 0) {
      const df = 1.05 * vForward * vForward;
      body.applyImpulse({ x: -up.x * df * dt, y: -up.y * df * dt, z: -up.z * df * dt }, true);
    }
    // keep the car from pitching/rolling too wildly in the air
    if (groundedCount < 2) {
      body.applyTorqueImpulse({ x: -av.x * 420 * dt, y: 0, z: -av.z * 420 * dt }, true);
      // gently roll the car back level while it is off the ground
      const axis = new THREE.Vector3().crossVectors(up, new THREE.Vector3(0, 1, 0));
      const k = 900 * (1 - THREE.MathUtils.clamp(up.y, 0, 1));
      body.applyTorqueImpulse({ x: axis.x * k * dt, y: 0, z: axis.z * k * dt }, true);
    }

    this.syncMesh();
  }

  syncMesh() {
    const q = this.quaternion;
    const p = this.position;
    const offset = new THREE.Vector3(0, -VISUAL_DROP, 0).applyQuaternion(q);
    this.mesh.position.copy(p).add(offset);
    this.mesh.quaternion.copy(q);

    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      const m = this.wheelMeshes[i];
      m.position.set(w.local.x, VISUAL_DROP + w.local.y - w.susp, w.local.z);
      m.rotation.set(0, w.steered ? this.steer : 0, 0);
      m.children[0].rotation.x = w.spin;
      m.children[1].rotation.x = w.spin;
    }

  }
}
