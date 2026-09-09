// Compact wire format for one car's transform. Rounding keeps a full 6-car
// batch well under the 256KB broadcast payload cap and off the wire cheaply.
export function packCar(v, extra = {}) {
  const p = v.position;
  const yaw = Math.atan2(v.forward.x, v.forward.z);
  return {
    x: round2(p.x), y: round2(p.y), z: round2(p.z),
    yaw: round3(yaw),
    steer: round2(v.steer || 0),
    speedKmh: Math.round(v.speedKmh || 0),
    lap: extra.lap ?? 0,
    finished: !!extra.finished,
    finishTime: extra.finishTime ?? null,
    best: extra.best ?? null,
    wrongWay: !!extra.wrongWay,
  };
}

function round2(n) { return Math.round(n * 100) / 100; }
function round3(n) { return Math.round(n * 1000) / 1000; }
