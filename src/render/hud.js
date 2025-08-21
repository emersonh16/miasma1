import { config } from "../core/config.js";

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// Lightweight FPS tracker (HUD-local; runs even when DevHUD is off)
let _fps = 0, _frames = 0, _last = performance.now();

export function drawHUD(ctx, player, w, h) {
  if (!player) return;

  // Update FPS once per second
  _frames++;
  const now = performance.now();
  if (now - _last >= 1000) { _fps = _frames; _frames = 0; _last = now; }

  const maxHP = Math.max(1, num(player.maxHealth, 100));
  const hpRaw = num(player.health, maxHP);
  const hp = Math.max(0, Math.min(maxHP, hpRaw));
  const pct = hp / maxHP;

  const barW = 200;
  const barH = 16;
  const pad  = 20;

  ctx.save();

  // Tiny FPS marker (always available; DevHUD toggle doesn't affect this)
  ctx.font = "12px monospace";
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "top";
  ctx.fillText(`${_fps} FPS`, pad, pad - 14);

  // Health bar
  ctx.fillStyle = "#000";
  ctx.fillRect(pad, pad, barW, barH);

  ctx.fillStyle = "#f00";
  ctx.fillRect(pad, pad, barW * pct, barH);

  ctx.strokeStyle = "#000";
  ctx.lineWidth = 2;
  ctx.strokeRect(pad + 0.5, pad + 0.5, barW - 1, barH - 1);

  ctx.fillStyle = "#fff";
  ctx.textBaseline = "middle";
  ctx.fillText(`${Math.round(hp)} / ${Math.round(maxHP)}`, pad + 8, pad + barH / 2);

  ctx.restore();
}
