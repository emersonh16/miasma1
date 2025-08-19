import { axis } from "../core/input.js";
import { config } from "../core/config.js";

export function makePlayer() {
  return { x: 0, y: 0, r: 20 };
}

export function updatePlayer(p, dt) {
  const a = axis();
  p.x += a.x * config.player.speed * dt;
  p.y += a.y * config.player.speed * dt;
}

export function drawPlayer(ctx, cam, p) {
  ctx.save();
  ctx.translate(Math.floor(-cam.x + p.x), Math.floor(-cam.y + p.y));
  ctx.beginPath();
  ctx.arc(0, 0, p.r, 0, Math.PI * 2);
ctx.fillStyle = "#a83c0f";   // deep burnt orange / red
ctx.fill();
ctx.lineWidth = 2;
ctx.strokeStyle = "#3b2618"; // dark mossy brown outline
ctx.stroke();
  ctx.restore();
}
