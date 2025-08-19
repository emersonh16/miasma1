// src/render/draw.js

export function clear(ctx, w, h) {
  ctx.clearRect(0, 0, w, h);
  // Desert ground
  ctx.fillStyle = "#5e4a28ff";
  ctx.fillRect(0, 0, w, h);
}

/**
 * World‑aligned grid that scrolls under the player.
 * Call AFTER translating to world space (w/2, h/2).
 */
export function drawGrid(ctx, cam, w, h, cell = 64) {
  const halfW = w / 2;
  const halfH = h / 2;
  const mod = (n, m) => ((n % m) + m) % m;

  const startX = -halfW - mod(-cam.x, cell);
  const startY = -halfH - mod(-cam.y, cell);

  ctx.save();
  ctx.lineWidth = 1;

  // Base grid
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  for (let x = startX; x <= halfW; x += cell) {
    ctx.beginPath();
    ctx.moveTo(x, -halfH);
    ctx.lineTo(x, halfH);
    ctx.stroke();
  }
  for (let y = startY; y <= halfH; y += cell) {
    ctx.beginPath();
    ctx.moveTo(-halfW, y);
    ctx.lineTo(halfW, y);
    ctx.stroke();
  }

  ctx.restore();
}
