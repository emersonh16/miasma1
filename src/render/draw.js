// src/render/draw.js

// Pre-make an earth pattern (once per context)
let earthPattern = null;
function ensureEarthPattern(ctx) {
  if (earthPattern) return earthPattern;
  const size = 64;
  const off = document.createElement("canvas");
  off.width = off.height = size;
  const octx = off.getContext("2d");

  // Simple dirt texture: two-tone speckle
  octx.fillStyle = "#5e4a28";
  octx.fillRect(0, 0, size, size);
  octx.fillStyle = "#4a3820";
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    octx.fillRect(x, y, 2, 2);
  }
  earthPattern = ctx.createPattern(off, "repeat");
  return earthPattern;
}

export function clear(ctx, w, h) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = ensureEarthPattern(ctx);
  ctx.fillRect(0, 0, w, h);
}



/**
 * World‑aligned grid that scrolls under the player.
 * Call AFTER translating to world space (w/2, h/2).
 */
export function drawGrid(ctx, cam, w, h, cell = 64) {
  const halfW = w / 2;
  const halfH = h / 2;
  // Offset grid by camera position so it scrolls opposite to movement.
  const startX = -halfW - (cam.x % cell);
  const startY = -halfH - (cam.y % cell);

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
