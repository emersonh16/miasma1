// src/world/biomes/swamp.js
// Swamp ground: deep mossy green with damp highlights.

let swampPattern = null;
const TILE = 64;

function ensureSwampPattern(ctx) {
  if (swampPattern) return swampPattern;

  const off = document.createElement("canvas");
  off.width = off.height = TILE;
  const o = off.getContext("2d");

  // Base (moss/peat)
  o.fillStyle = "#223322";
  o.fillRect(0, 0, TILE, TILE);

  // Darker clumps
  o.fillStyle = "#1b2a1b";
  for (let i = 0; i < 180; i++) {
    const x = (Math.random() * TILE) | 0;
    const y = (Math.random() * TILE) | 0;
    const r = 1 + ((Math.random() * 2) | 0);
    o.fillRect(x, y, r, r);
  }

  // Lighter wet flecks
  o.fillStyle = "#4c6a4c";
  for (let i = 0; i < 90; i++) {
    const x = (Math.random() * TILE) | 0;
    const y = (Math.random() * TILE) | 0;
    o.fillRect(x, y, 1, 1);
  }

  swampPattern = ctx.createPattern(off, "repeat");
  return swampPattern;
}

export function drawSwampBiome(ctx, cam, w, h) {
  const pat = ensureSwampPattern(ctx);
  const ox = -Math.floor((((cam?.x ?? 0) % TILE) + TILE) % TILE);
  const oy = -Math.floor((((cam?.y ?? 0) % TILE) + TILE) % TILE);

  ctx.save();
  ctx.translate(ox, oy);
  ctx.fillStyle = pat;
  ctx.fillRect(-TILE, -TILE, w + TILE * 2, h + TILE * 2);
  ctx.restore();
}
