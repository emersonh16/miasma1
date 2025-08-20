import { config } from "../core/config.js";

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function drawHUD(ctx, player, w, h) {
  if (!player) return;

  const maxHP = Math.max(1, num(player.maxHealth, 100));
  const hpRaw = num(player.health, maxHP);
  const hp = Math.max(0, Math.min(maxHP, hpRaw));
  const pct = hp / maxHP;

  const barW = 200;
  const barH = 16;
  const pad  = 20;

  ctx.save();

  // background (black)
  ctx.fillStyle = "#000";
  ctx.fillRect(pad, pad, barW, barH);

  // health fill (solid red)
  ctx.fillStyle = "#f00";
  ctx.fillRect(pad, pad, barW * pct, barH);

  // border (black)
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 2;
  ctx.strokeRect(pad + 0.5, pad + 0.5, barW - 1, barH - 1);

  // text (white numbers)
  ctx.font = "12px monospace";
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "middle";
  ctx.fillText(`${Math.round(hp)} / ${Math.round(maxHP)}`, pad + 8, pad + barH / 2);

  ctx.restore();
}
