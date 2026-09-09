import * as THREE from 'three';
import { createCarModel } from './carModel.js';
import { GEOMETRY } from './vehicle.js';

const { REST, ATTACH_Y, HALF_TRACK, FRONT_Z, REAR_Z, VISUAL_DROP, RADIUS } = GEOMETRY;
const RENDER_DELAY = 0.10; // seconds of intentional buffering for smooth interpolation

/**
 * A networked car driven by position/rotation snapshots instead of physics.
 * Exposes the same read surface as Vehicle (position, quaternion, forward,
 * speedKmh, mesh) so Race/Hud/Minimap can't tell the difference, plus a
 * kinematic Rapier body so local cars still collide with it physically.
 */
export class RemoteVehicle {
  constructor(ctx, opts) {
    const { world, RAPIER, scene } = ctx;
    this.world = world;
    this.name = opts.name || 'Player';
    this.color = opts.color ?? 0x9fb3ff;
    this.isPlayer = false;
    this.isRemote = true;

    const yaw = opts.heading || 0;
    const desc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(opts.position.x, opts.position.y, opts.position.z)
      .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });
    this.body = world.createRigidBody(desc);

    const half = { x: 0.92, y: 0.40, z: 2.12 };
    const col = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setTranslation(0, -0.16, 0);
    col.setCollisionGroups(0x0002ffff);
    world.createCollider(col, this.body);

    const model = createCarModel(this.color, opts.accent);
    this.mesh = model.group;
    this.wheelMeshes = model.wheels;
    scene.add(this.mesh);

    this.wheelLocals = [
      new THREE.Vector3(-HALF_TRACK, ATTACH_Y, FRONT_Z),
      new THREE.Vector3(HALF_TRACK, ATTACH_Y, FRONT_Z),
      new THREE.Vector3(-HALF_TRACK, ATTACH_Y, REAR_Z),
      new THREE.Vector3(HALF_TRACK, ATTACH_Y, REAR_Z),
    ];
    this.wheelSteered = [true, true, false, false];
    this.spin = 0;

    // interpolation buffer: [{t, pos:Vector3, yaw, steer, speedKmh, lap, finished, finishTime, best, wrongWay}]
    this.buffer = [];
    this.clockOffset = null; // localNow - remoteT, learned from the first snapshot

    this.pos = new THREE.Vector3(opts.position.x, opts.position.y, opts.position.z);
    this.quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    this.steer = 0;
    this.speedKmh = 0;
    this.gear = 1;
    this.reverse = false;
    this.rpm = 900;
    this.offRoad = false;
    this.grounded = true;
    this.tilt = 1;

    // authoritative race state, mirrored from the network rather than computed locally
    this.netLap = 0;
    this.netFinished = false;
    this.netFinishTime = null;
    this.netBest = null;
    this.netWrongWay = false;

    this._v = new THREE.Vector3();
    this._q = new THREE.Quaternion();
  }

  /** payload: { t, x, y, z, yaw, steer, speedKmh, lap, finished, finishTime, best, wrongWay } */
  pushSnapshot(payload) {
    const now = performance.now() / 1000;
    if (this.clockOffset === null) this.clockOffset = now - payload.t;
    this.buffer.push({ ...payload, localT: payload.t + this.clockOffset });
    // keep a short history; drop anything older than what we'd ever render
    const cutoff = now - RENDER_DELAY - 1.0;
    while (this.buffer.length > 2 && this.buffer[0].localT < cutoff) this.buffer.shift();
    if (this.buffer.length > 12) this.buffer.shift();

    this.netLap = payload.lap;
    this.netFinished = payload.finished;
    this.netFinishTime = payload.finishTime ?? this.netFinishTime;
    this.netBest = payload.best ?? this.netBest;
    this.netWrongWay = !!payload.wrongWay;
  }

  get position() { return this._v.copy(this.pos); }
  get quaternion() { return this._q.copy(this.quat); }
  get forward() { return new THREE.Vector3(0, 0, 1).applyQuaternion(this.quat); }

  /** Called every render frame; advances the interpolated pose toward "now - RENDER_DELAY". */
  update(dt) {
    const renderT = performance.now() / 1000 - RENDER_DELAY;
    const buf = this.buffer;

    let a = null, b = null;
    for (let i = 0; i < buf.length - 1; i++) {
      if (buf[i].localT <= renderT && buf[i + 1].localT >= renderT) { a = buf[i]; b = buf[i + 1]; break; }
    }

    if (a && b) {
      const span = Math.max(1e-3, b.localT - a.localT);
      const t = THREE.MathUtils.clamp((renderT - a.localT) / span, 0, 1);
      this.pos.set(
        THREE.MathUtils.lerp(a.x, b.x, t),
        THREE.MathUtils.lerp(a.y, b.y, t),
        THREE.MathUtils.lerp(a.z, b.z, t)
      );
      const qa = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a.yaw);
      const qb = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.yaw);
      this.quat.copy(qa).slerp(qb, t);
      this.steer = THREE.MathUtils.lerp(a.steer, b.steer, t);
      this.speedKmh = THREE.MathUtils.lerp(a.speedKmh, b.speedKmh, t);
    } else if (buf.length && renderT >= buf[buf.length - 1].localT) {
      // caught up to (or past) the freshest snapshot — packet loss or a latency
      // spike, so extrapolate forward a little rather than freezing.
      const last = buf[buf.length - 1];
      const age = THREE.MathUtils.clamp(renderT - last.localT, 0, 0.25);
      this.quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), last.yaw);
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this.quat);
      const speed = last.speedKmh / 3.6;
      this.pos.set(last.x + fwd.x * speed * age, last.y, last.z + fwd.z * speed * age);
      this.steer = last.steer;
      this.speedKmh = last.speedKmh;
    } else if (buf.length) {
      // renderT is still before our earliest buffered sample (just connected,
      // or the render-delay window hasn't filled yet) — hold at the oldest
      // known snapshot rather than jumping ahead to the newest one.
      const first = buf[0];
      this.quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), first.yaw);
      this.pos.set(first.x, first.y, first.z);
      this.steer = first.steer;
      this.speedKmh = first.speedKmh;
    }
    // else: no snapshots at all yet — keep whatever position we were constructed with.

    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z });
    this.body.setNextKinematicRotation({ x: this.quat.x, y: this.quat.y, z: this.quat.z, w: this.quat.w });

    this.spin += (this.speedKmh / 3.6 / RADIUS) * dt;
    this.syncMesh();
  }

  syncMesh() {
    const offset = new THREE.Vector3(0, -VISUAL_DROP, 0).applyQuaternion(this.quat);
    this.mesh.position.copy(this.pos).add(offset);
    this.mesh.quaternion.copy(this.quat);
    for (let i = 0; i < 4; i++) {
      const local = this.wheelLocals[i];
      const m = this.wheelMeshes[i];
      m.position.set(local.x, VISUAL_DROP + local.y - REST, local.z);
      m.rotation.set(0, this.wheelSteered[i] ? this.steer : 0, 0);
      m.children[0].rotation.x = this.spin;
      m.children[1].rotation.x = this.spin;
    }
  }

  dispose() {
    this.world.removeRigidBody(this.body);
    this.mesh.parent?.remove(this.mesh);
  }
}
