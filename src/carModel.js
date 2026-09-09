import * as THREE from 'three';

const box = (w, h, d, color, x, y, z, opts = {}) => {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshLambertMaterial({ color, flatShading: true, ...opts })
  );
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
};

/**
 * Chunky low-poly race car. +Z is forward, origin at the chassis centre.
 * Returns { group, wheels: [FL, FR, RL, RR] }.
 */
export function createCarModel(color, accent = 0xf3a13a) {
  const g = new THREE.Group();
  const dark = 0x1b1f22;
  const body = new THREE.Color(color);
  const shade = body.clone().multiplyScalar(0.78).getHex();

  // main tub
  g.add(box(1.86, 0.44, 4.10, color, 0, 0.52, 0));
  // nose wedge
  g.add(box(1.70, 0.26, 1.10, color, 0, 0.36, 1.85));
  // rear deck
  g.add(box(1.80, 0.30, 0.90, shade, 0, 0.74, -1.72));
  // cabin
  g.add(box(1.56, 0.42, 1.70, shade, 0, 0.92, -0.15));
  // glass
  g.add(box(1.44, 0.30, 1.52, 0x121a1e, 0, 0.99, -0.10));
  // side sills
  g.add(box(1.98, 0.18, 2.60, shade, 0, 0.34, -0.1));
  // rear wing
  g.add(box(1.86, 0.10, 0.52, dark, 0, 1.10, -2.02));
  g.add(box(0.12, 0.34, 0.14, dark, -0.70, 0.94, -2.00));
  g.add(box(0.12, 0.34, 0.14, dark, 0.70, 0.94, -2.00));
  // diffuser + splitter
  g.add(box(1.86, 0.12, 0.40, dark, 0, 0.28, -2.14));
  g.add(box(1.90, 0.08, 0.44, dark, 0, 0.24, 2.24));
  // accent stripe
  g.add(box(1.88, 0.10, 0.30, accent, 0, 0.62, 1.20));
  // lights
  g.add(box(0.44, 0.12, 0.08, 0xfff2c4, -0.58, 0.50, 2.24, { emissive: 0x5a4a1a }));
  g.add(box(0.44, 0.12, 0.08, 0xfff2c4, 0.58, 0.50, 2.24, { emissive: 0x5a4a1a }));
  g.add(box(0.40, 0.12, 0.08, 0xd02a24, -0.60, 0.72, -2.18, { emissive: 0x4a0e0c }));
  g.add(box(0.40, 0.12, 0.08, 0xd02a24, 0.60, 0.72, -2.18, { emissive: 0x4a0e0c }));
  // mirrors
  g.add(box(0.26, 0.10, 0.14, dark, -1.02, 0.86, 0.62));
  g.add(box(0.26, 0.10, 0.14, dark, 1.02, 0.86, 0.62));

  // wheels
  const wheels = [];
  const tyreGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.30, 10);
  tyreGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.20, 0.20, 0.32, 8);
  rimGeo.rotateZ(Math.PI / 2);
  for (let i = 0; i < 4; i++) {
    const w = new THREE.Group();
    const tyre = new THREE.Mesh(tyreGeo, new THREE.MeshLambertMaterial({ color: 0x14171a, flatShading: true }));
    tyre.castShadow = true;
    const rim = new THREE.Mesh(rimGeo, new THREE.MeshLambertMaterial({ color: 0xc9ccc6, flatShading: true }));
    w.add(tyre, rim);
    wheels.push(w);
    g.add(w);
  }

  return { group: g, wheels };
}
