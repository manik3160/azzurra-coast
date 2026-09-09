import * as THREE from 'three';

export const ROAD_HALF = 6.2;        // half road width (m)
const KERB_W = 1.0;                  // kerb strip width
const APRON_W = 7.5;                   // sand run-off width
const RAIL_OFFSET = ROAD_HALF + KERB_W + APRON_W;
const SAMPLES = 1100;                 // centerline samples
const SCALE = 1.70;                  // world scale of the control polygon

// Control points traced from the reference minimap: a closed blob with a long
// right-hand sweeper, a hairpin and a tight S-section on the lower right.
const CONTROL = [
  // main straight, west -> east (the start / finish line sits at index 0)
  [-130, -278], [   0, -278], [ 130, -278], [ 250, -274],
  // long right-hand sweeper up the east side
  [ 318, -200], [ 336,  -70], [ 314,   60], [ 228,  152],
  // northern hairpin
  [ 214,  250], [ 122,  310], [   8,  300],
  // tight S back onto the west side
  [ -52,  232], [ -26,  146], [-104,   98],
  [-180,  132], [-268,   78], [-278,  -58], [-250, -180],
  // final corner onto the straight
  [-215, -262],
];

export function buildTrack(scene, world, RAPIER) {
  const pts = CONTROL.map(([x, z]) => new THREE.Vector3(x * SCALE, 0, z * SCALE));
  const curve = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5);

  // Even arc-length sampling.
  const raw = curve.getSpacedPoints(SAMPLES);
  const center = raw.slice(0, SAMPLES);

  const tangent = [], normal = [], cum = [];
  let length = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const a = center[(i - 1 + SAMPLES) % SAMPLES];
    const b = center[(i + 1) % SAMPLES];
    const t = new THREE.Vector3().subVectors(b, a).normalize();
    tangent.push(t);
    normal.push(new THREE.Vector3(-t.z, 0, t.x)); // left of travel
  }
  for (let i = 0; i < SAMPLES; i++) {
    cum.push(length);
    length += center[i].distanceTo(center[(i + 1) % SAMPLES]);
  }

  // Signed curvature per sample (1/m), positive = turning left.
  const curvature = [];
  for (let i = 0; i < SAMPLES; i++) {
    const t0 = tangent[(i - 2 + SAMPLES) % SAMPLES];
    const t1 = tangent[(i + 2) % SAMPLES];
    const ds = center[(i - 2 + SAMPLES) % SAMPLES].distanceTo(center[(i + 2) % SAMPLES]) || 1;
    const cross = t0.x * t1.z - t0.z * t1.x;
    const dot = THREE.MathUtils.clamp(t0.dot(t1), -1, 1);
    curvature.push((Math.acos(dot) * Math.sign(-cross)) / ds);
  }

  const group = new THREE.Group();
  group.name = 'track';
  scene.add(group);

  // ---------- road surface ----------
  const road = ribbon(center, normal, -ROAD_HALF, ROAD_HALF, 0.02);
  const roadMesh = new THREE.Mesh(road, new THREE.MeshLambertMaterial({ color: 0x585f66, side: THREE.DoubleSide }));
  roadMesh.receiveShadow = true;
  group.add(roadMesh);

  // centre dashes
  const dash = new THREE.BufferGeometry();
  buildDashes(dash, center, tangent, normal);
  group.add(new THREE.Mesh(dash, new THREE.MeshBasicMaterial({ color: 0xdfe3e0, side: THREE.DoubleSide })));

  // white track edge lines
  for (const s of [-1, 1]) {
    const g = ribbon(center, normal, s * (ROAD_HALF - 0.34), s * ROAD_HALF, 0.035);
    group.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xe8ebe6, side: THREE.DoubleSide })));
  }

  // ---------- kerbs (alternating red / white) ----------
  for (const s of [-1, 1]) {
    const red = [], white = [];
    for (let i = 0; i < SAMPLES; i++) ((Math.floor(i / 2) % 2) ? white : red).push(i);
    group.add(kerbMesh(center, normal, s, red, 0xe0472c));
    group.add(kerbMesh(center, normal, s, white, 0xf2f2ee));
  }

  // ---------- sand apron ----------
  for (const s of [-1, 1]) {
    const inner = s * (ROAD_HALF + KERB_W);
    const outer = s * (ROAD_HALF + KERB_W + APRON_W);
    const g = ribbon(center, normal, Math.min(inner, outer), Math.max(inner, outer), 0.005);
    group.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0xcfc39a, side: THREE.DoubleSide })));
  }

  // ---------- start / finish ----------
  group.add(startLine(center[0], tangent[0], normal[0]));

  // ---------- guardrails ----------
  buildGuardrails(group, world, RAPIER, center, tangent, normal);

  // ---------- physics: flat ground plane ----------
  const gBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -2, 0));
  const gCol = RAPIER.ColliderDesc.cuboid(2000, 2, 2000).setFriction(1.0);
  gCol.setCollisionGroups(0x0001ffff);
  world.createCollider(gCol, gBody);

  // ---------- grass ----------
  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(4000, 4000),
    new THREE.MeshLambertMaterial({ color: 0x86a35c })
  );
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = -0.02;
  grass.receiveShadow = true;
  scene.add(grass);

  // racing line for the AI: centerline pulled toward the apexes
  const line = racingLine(center, normal, curvature);

  return { center, tangent, normal, curvature, cum, length, line, samples: SAMPLES, group };
}

// ---------------------------------------------------------------- helpers

function ribbon(center, normal, from, to, y) {
  const n = center.length;
  const pos = new Float32Array(n * 2 * 3);
  const idx = [];
  for (let i = 0; i < n; i++) {
    const c = center[i], nm = normal[i];
    pos[i * 6 + 0] = c.x + nm.x * from; pos[i * 6 + 1] = y; pos[i * 6 + 2] = c.z + nm.z * from;
    pos[i * 6 + 3] = c.x + nm.x * to;   pos[i * 6 + 4] = y; pos[i * 6 + 5] = c.z + nm.z * to;
  }
  for (let i = 0; i < n; i++) {
    const a = i * 2, b = a + 1, c = ((i + 1) % n) * 2, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function kerbMesh(center, normal, side, indices, color) {
  const n = center.length;
  const verts = [], idx = [];
  const inner = side * (ROAD_HALF + 0.02);
  const outer = side * (ROAD_HALF + KERB_W);
  let v = 0;
  for (const i of indices) {
    const j = (i + 1) % n;
    for (const k of [i, j]) {
      const c = center[k], nm = normal[k];
      verts.push(c.x + nm.x * inner, 0.06, c.z + nm.z * inner);
      verts.push(c.x + nm.x * outer, 0.10, c.z + nm.z * outer);
    }
    idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
    v += 4;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide }));
}

function buildDashes(geo, center, tangent, normal) {
  const n = center.length;
  const verts = [], idx = [];
  let v = 0;
  for (let i = 0; i < n; i += 12) {
    const j = (i + 3) % n;
    const w = 0.13;
    for (const k of [i, j]) {
      const c = center[k], nm = normal[k];
      verts.push(c.x - nm.x * w, 0.04, c.z - nm.z * w);
      verts.push(c.x + nm.x * w, 0.04, c.z + nm.z * w);
    }
    idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
    v += 4;
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
}

function startLine(p, t, n) {
  const g = new THREE.Group();
  const cols = 16, rows = 3, cw = (ROAD_HALF * 2) / cols, rl = 0.9;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(cw, rl),
        new THREE.MeshBasicMaterial({ color: (r + c) % 2 ? 0x14181a : 0xf0f2ee })
      );
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = -Math.atan2(t.z, t.x) + Math.PI / 2;
      const off = -ROAD_HALF + cw * (c + 0.5);
      m.position.set(
        p.x + n.x * off + t.x * (r - 1) * rl,
        0.05,
        p.z + n.z * off + t.z * (r - 1) * rl
      );
      g.add(m);
    }
  }
  return g;
}

function buildGuardrails(group, world, RAPIER, center, tangent, normal) {
  const n = center.length;
  const step = 4;
  const postGeo = new THREE.BoxGeometry(0.16, 1.0, 0.16);
  const postMat = new THREE.MeshLambertMaterial({ color: 0x8d9499 });
  const railMat = new THREE.MeshLambertMaterial({ color: 0xb9c0c4 });
  const count = Math.floor(n / step) * 2;
  const posts = new THREE.InstancedMesh(postGeo, postMat, count);
  const dummy = new THREE.Object3D();
  let pi = 0;

  for (const side of [-1, 1]) {
    const pts = [];
    for (let i = 0; i < n; i += step) {
      const c = center[i], nm = normal[i];
      pts.push(new THREE.Vector3(c.x + nm.x * side * RAIL_OFFSET, 0, c.z + nm.z * side * RAIL_OFFSET));
    }
    // posts
    for (const p of pts) {
      dummy.position.set(p.x, 0.5, p.z);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      posts.setMatrixAt(pi++, dummy.matrix);
    }
    // rail segments + colliders
    const verts = [], idx = [];
    let v = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const dir = new THREE.Vector3().subVectors(b, a);
      const len = dir.length();
      dir.normalize();
      const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
      const yaw = Math.atan2(dir.x, dir.z);

      for (const [p0, p1] of [[a, b]]) {
        verts.push(p0.x, 0.55, p0.z, p0.x, 1.05, p0.z, p1.x, 0.55, p1.z, p1.x, 1.05, p1.z);
        idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3, v + 1, v + 2, v, v + 3, v + 2, v + 1);
        v += 4;
      }

      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed()
          .setTranslation(mid.x, 0.8, mid.z)
          .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
      );
      const col = RAPIER.ColliderDesc.cuboid(0.2, 0.8, len / 2 + 0.05)
        .setFriction(0.2).setRestitution(0.15);
      col.setCollisionGroups(0x0001ffff);
      world.createCollider(col, body);
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    rg.setIndex(idx);
    rg.computeVertexNormals();
    const rail = new THREE.Mesh(rg, railMat);
    rail.material.side = THREE.DoubleSide;
    group.add(rail);
  }
  posts.castShadow = true;
  group.add(posts);
}

function racingLine(center, normal, curvature) {
  const n = center.length;
  const maxOff = ROAD_HALF - 2.1;
  let off = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    // apex is on the inside of the corner (curvature > 0 => turning left => inside is left)
    off[i] = THREE.MathUtils.clamp(curvature[i] * 900, -1, 1) * maxOff;
  }
  for (let pass = 0; pass < 60; pass++) {
    const next = off.slice();
    for (let i = 0; i < n; i++) {
      next[i] = (off[(i - 1 + n) % n] + off[i] * 1.4 + off[(i + 1) % n]) / 3.4;
    }
    off = next;
  }
  return center.map((c, i) => new THREE.Vector3(
    c.x + normal[i].x * off[i], 0, c.z + normal[i].z * off[i]
  ));
}
