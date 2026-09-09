import * as THREE from 'three';

export const MODES = ['CHASE', 'HOOD', 'ORBIT'];

export class ChaseCamera {
  constructor(camera) {
    this.camera = camera;
    this.mode = 0;
    this.pos = new THREE.Vector3(0, 5, -12);
    this.look = new THREE.Vector3();
    this.orbitAngle = 0;
  }

  cycle() { this.mode = (this.mode + 1) % MODES.length; return MODES[this.mode]; }
  get name() { return MODES[this.mode]; }

  snap(vehicle) {
    this.pos.copy(this.desired(vehicle, 'CHASE'));
    this.camera.position.copy(this.pos);
  }

  desired(v, mode) {
    const q = v.quaternion;
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const p = v.position;
    if (mode === 'HOOD') {
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      return p.clone().addScaledVector(fwd, 0.62).addScaledVector(up, 0.66);
    }
    if (mode === 'ORBIT') {
      return p.clone().add(new THREE.Vector3(
        Math.cos(this.orbitAngle) * 11, 4.5, Math.sin(this.orbitAngle) * 11));
    }
    const flat = new THREE.Vector3(fwd.x, 0, fwd.z).normalize();
    return p.clone().addScaledVector(flat, -7.4).add(new THREE.Vector3(0, 2.85, 0));
  }

  update(dt, v) {
    const mode = this.name;
    this.orbitAngle += dt * 0.35;
    const want = this.desired(v, mode);
    const k = mode === 'HOOD' ? 1 : 1 - Math.pow(0.0015, dt);
    this.pos.lerp(want, k);
    if (mode === 'HOOD') this.pos.copy(want);
    this.camera.position.copy(this.pos);

    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(v.quaternion);
    const flat = new THREE.Vector3(fwd.x, 0, fwd.z).normalize();
    const target = v.position.clone()
      .addScaledVector(mode === 'HOOD' ? fwd : flat, mode === 'HOOD' ? 20 : 10)
      .add(new THREE.Vector3(0, mode === 'HOOD' ? 0.4 : 1.1, 0));
    this.look.lerp(target, 1 - Math.pow(0.0004, dt));
    this.camera.lookAt(this.look);

    const targetFov = 62 + THREE.MathUtils.clamp(v.speedKmh / 260, 0, 1) * 14;
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 2.5);
    this.camera.updateProjectionMatrix();
  }
}
