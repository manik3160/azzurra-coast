import * as THREE from 'three';

// Deterministic RNG so the world looks the same every session.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function buildScenery(scene, track) {
  const rand = rng(20260909);
  const { center } = track;

  const nearTrack = (x, z, minDist) => {
    // cheap distance check against a decimated centerline
    for (let i = 0; i < center.length; i += 4) {
      const dx = center[i].x - x, dz = center[i].z - z;
      if (dx * dx + dz * dz < minDist * minDist) return true;
    }
    return false;
  };

  // ---------- conifers ----------
  const trunkGeo = new THREE.CylinderGeometry(0.28, 0.36, 1.6, 5);
  const coneGeo = new THREE.ConeGeometry(1, 1, 7);
  const greens = [0x2f6b3d, 0x3a7a45, 0x27593a, 0x468551];
  const TREES = 900;
  const trunks = new THREE.InstancedMesh(
    trunkGeo, new THREE.MeshLambertMaterial({ color: 0x51402f }), TREES);
  const canopy = new THREE.InstancedMesh(
    coneGeo, new THREE.MeshLambertMaterial({ flatShading: true, vertexColors: true }), TREES);
  canopy.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(TREES * 3), 3);
  const d = new THREE.Object3D();
  const col = new THREE.Color();

  let placed = 0, guard = 0;
  while (placed < TREES && guard++ < TREES * 40) {
    const ang = rand() * Math.PI * 2;
    const r = 40 + Math.pow(rand(), 0.65) * 700;
    const seedPt = center[(rand() * center.length) | 0];
    const x = seedPt.x + Math.cos(ang) * r;
    const z = seedPt.z + Math.sin(ang) * r;
    if (nearTrack(x, z, 34)) continue;

    const h = 6 + rand() * 12;
    const w = h * (0.22 + rand() * 0.1);
    d.position.set(x, 0.8, z);
    d.rotation.set(0, rand() * 6.28, 0);
    d.scale.set(1, 1, 1);
    d.updateMatrix();
    trunks.setMatrixAt(placed, d.matrix);

    d.position.set(x, 1.4 + h / 2, z);
    d.scale.set(w, h, w);
    d.updateMatrix();
    canopy.setMatrixAt(placed, d.matrix);
    col.setHex(greens[(rand() * greens.length) | 0]);
    canopy.setColorAt(placed, col);
    placed++;
  }
  trunks.count = canopy.count = placed;
  canopy.castShadow = true;
  scene.add(trunks, canopy);

  // ---------- rocks ----------
  const ROCKS = 260;
  const rocks = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 0),
    new THREE.MeshLambertMaterial({ color: 0xbfbdae, flatShading: true }), ROCKS);
  placed = 0; guard = 0;
  while (placed < ROCKS && guard++ < ROCKS * 40) {
    const seedPt = center[(rand() * center.length) | 0];
    const ang = rand() * Math.PI * 2;
    const r = 26 + rand() * 240;
    const x = seedPt.x + Math.cos(ang) * r;
    const z = seedPt.z + Math.sin(ang) * r;
    if (nearTrack(x, z, 24)) continue;
    const s = 0.8 + rand() * 3.4;
    d.position.set(x, s * 0.35, z);
    d.rotation.set(rand(), rand() * 6.28, rand());
    d.scale.set(s, s * (0.5 + rand() * 0.4), s);
    d.updateMatrix();
    rocks.setMatrixAt(placed++, d.matrix);
  }
  rocks.count = placed;
  scene.add(rocks);

  // ---------- distant hills ----------
  const hills = new THREE.Group();
  for (let i = 0; i < 26; i++) {
    const ang = (i / 26) * Math.PI * 2 + rand() * 0.2;
    const r = 1150 + rand() * 550;
    const h = 90 + rand() * 210;
    const m = new THREE.Mesh(
      new THREE.ConeGeometry(h * (1.1 + rand()), h, 6),
      new THREE.MeshLambertMaterial({ color: new THREE.Color(0x6e8a72).lerp(new THREE.Color(0xa9bcc4), rand() * 0.6), flatShading: true })
    );
    m.position.set(Math.cos(ang) * r, h / 2 - 12, Math.sin(ang) * r);
    m.rotation.y = rand() * 6.28;
    hills.add(m);
  }
  scene.add(hills);

  // ---------- sky dome ----------
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(2600, 24, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        top: { value: new THREE.Color(0x93b4c4) },
        bottom: { value: new THREE.Color(0xd9e4e2) },
      },
      vertexShader: `varying float vY; void main(){ vY = normalize(position).y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying float vY; uniform vec3 top; uniform vec3 bottom;
        void main(){ gl_FragColor = vec4(mix(bottom, top, clamp(vY*1.4+0.15,0.0,1.0)), 1.0); }`,
    })
  );
  scene.add(sky);

  return { sky };
}
