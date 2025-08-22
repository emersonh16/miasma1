// src/world/biomes/snow.js
// Snow ground: cold white with soft blue shadows.

let snowPattern = null;
const TILE = 64;

function ensureSnowPattern(ctx) {
  if (snowPattern) return snowPattern;

  const off = document.createElement("canvas");
  off.width = off.height = TILE;
  const o = off.getContext("2d");

  // Base (snow white)
  o.fillStyle = "#f3f7fb";
  o.fillRect(0, 0, TILE, TILE);

  // Shadow clumps
  o.fillStyle = "#c7d7e6";
  for (let i = 0; i < 180; i++) {
    const x = (Math.random() * TILE) | 0;
    const y = (Math.random() * TILE) | 0;
    const r = 1 + ((Math.random() * 2) | 0);
    o.fillRect(x, y, r, r);
  }

  // Bright flecks
  o.fillStyle = "#ffffff";
  for (let i = 0; i < 90; i++) {
    const x = (Math.random() * TILE) | 0;
    const y = (Math.random() * TILE) | 0;
    o.fillRect(x, y, 1, 1);
  }

  snowPattern = ctx.createPattern(off, "repeat");
  return snowPattern;
}

export function drawSnowBiome(ctx, cam, w, h) {
  const pat = ensureSnowPattern(ctx);
  const ox = -Math.floor((((cam?.x ?? 0) % TILE) + TILE) % TILE);
  const oy = -Math.floor((((cam?.y ?? 0) % TILE) + TILE) % TILE);

  ctx.save();
  ctx.translate(ox, oy);
  ctx.fillStyle = pat;
  ctx.fillRect(-TILE, -TILE, w + TILE * 2, h + TILE * 2);
  ctx.restore();
}
