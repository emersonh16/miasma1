const state = { mode: "cone" }; // "bubble" | "cone" | "laser"

export function setMode(m) { state.mode = m; }

export function raycast(origin, dir, params = {}) {
  // Placeholder: returns no hits; clears a little fog straight ahead.
  return { hits: [], clearedFog: 3 };
}

export function draw(ctx, cam, player) {
  ctx.save();
  ctx.translate(-cam.x + player.x, -cam.y + player.y);
  ctx.globalAlpha = 0.8;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(120, -20);
  ctx.lineTo(120, 20);
  ctx.closePath();
  ctx.fillStyle = "rgba(255,240,160,0.35)";
  ctx.fill();
  ctx.restore();
}
