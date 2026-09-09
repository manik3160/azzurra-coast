export class Minimap {
  constructor(canvas, track) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.track = track;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = 320 * dpr;
    canvas.height = 320 * dpr;
    this.ctx.scale(dpr, dpr);
    this.size = 320;

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of track.center) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    const pad = 26;
    const s = Math.min((this.size - pad * 2) / (maxX - minX), (this.size - pad * 2) / (maxZ - minZ));
    this.scale = s;
    this.ox = this.size / 2 - ((minX + maxX) / 2) * s;
    this.oy = this.size / 2 - ((minZ + maxZ) / 2) * s;
  }

  p(v) { return [v.x * this.scale + this.ox, v.z * this.scale + this.oy]; }

  draw(entries) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.size, this.size);

    // soft backdrop so the outline reads over bright asphalt
    const g = ctx.createRadialGradient(this.size / 2, this.size / 2, 10, this.size / 2, this.size / 2, this.size / 2);
    g.addColorStop(0, 'rgba(10,14,16,0.34)');
    g.addColorStop(1, 'rgba(10,14,16,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.size, this.size);

    ctx.beginPath();
    const pts = this.track.center;
    for (let i = 0; i <= pts.length; i += 4) {
      const [x, y] = this.p(pts[i % pts.length]);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.72)';
    ctx.lineWidth = 3.2;
    ctx.stroke();

    // start / finish tick
    const [sx, sy] = this.p(pts[0]);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(sx - 3, sy - 3, 6, 6);

    for (const e of entries) {
      const [x, y] = this.p(e.vehicle.position);
      ctx.beginPath();
      ctx.arc(x, y, e.isPlayer ? 5 : 3.6, 0, Math.PI * 2);
      ctx.fillStyle = e.isPlayer ? '#c8f527' : `#${e.color.toString(16).padStart(6, '0')}`;
      ctx.fill();
      if (e.isPlayer) {
        ctx.strokeStyle = 'rgba(0,0,0,.55)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
  }
}
