// src/world/biomes/desert.js
// Desert ground: sun‑bleached sand with subtle grit.

let desertPattern = null;
const TILE = 64;

function ensureDesertPattern(ctx) {
  if (desertPattern) return desertPattern;

  const off = document.createElement("canvas");
  off.width = off.height = TILE;
  const o = off.getContext("2d");

  // Base (sand)
  o.fillStyle = "#e3d6a3";
  o.fillRect(0, 0, TILE, TILE);

  // Darker clumps
  o.fillStyle = "#c8b888";
  for (let i = 0; i < 180; i++) {
    const x = (Math.random() * TILE) | 0;
    const y = (Math.random() * TILE) | 0;
    const r = 1 + ((Math.random() * 2) | 0);
    o.fillRect(x, y, r, r);
  }

  // Lighter flecks
  o.fillStyle = "#f5e8c6";
  for (let i = 0; i < 90; i++) {
    const x = (Math.random() * TILE) | 0;
    const y = (Math.random() * TILE) | 0;
    o.fillRect(x, y, 1, 1);
  }

  desertPattern = ctx.createPattern(off, "repeat");
  return desertPattern;
}

export function drawDesertBiome(ctx, cam, w, h) {
  const pat = ensureDesertPattern(ctx);
  const ox = -Math.floor((((cam?.x ?? 0) % TILE) + TILE) % TILE);
  const oy = -Math.floor((((cam?.y ?? 0) % TILE) + TILE) % TILE);

  ctx.save();
  ctx.translate(ox, oy);
  ctx.fillStyle = pat;
  ctx.fillRect(-TILE, -TILE, w + TILE * 2, h + TILE * 2);
  ctx.restore();
}
