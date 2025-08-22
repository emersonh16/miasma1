// src/world/biomes/lava.js
// Lava ground: dark crust with hot ember flecks.

let lavaPattern = null;
const TILE = 64;

function ensureLavaPattern(ctx) {
  if (lavaPattern) return lavaPattern;

  const off = document.createElement("canvas");
  off.width = off.height = TILE;
  const o = off.getContext("2d");

  // Base (dark maroon/charcoal)
  o.fillStyle = "#2b0d0d";
  o.fillRect(0, 0, TILE, TILE);

  // Darker clumps
  o.fillStyle = "#120607";
  for (let i = 0; i < 180; i++) {
    const x = (Math.random() * TILE) | 0;
    const y = (Math.random() * TILE) | 0;
    const r = 1 + ((Math.random() * 2) | 0);
    o.fillRect(x, y, r, r);
  }

  // Hot ember flecks
  o.fillStyle = "#ff7a00";
  for (let i = 0; i < 90; i++) {
    const x = (Math.random() * TILE) | 0;
    const y = (Math.random() * TILE) | 0;
    o.fillRect(x, y, 1, 1);
  }

  lavaPattern = ctx.createPattern(off, "repeat");
  return lavaPattern;
}

export function drawLavaBiome(ctx, cam, w, h) {
  const pat = ensureLavaPattern(ctx);
  const ox = -Math.floor((((cam?.x ?? 0) % TILE) + TILE) % TILE);
  const oy = -Math.floor((((cam?.y ?? 0) % TILE) + TILE) % TILE);

  ctx.save();
  ctx.translate(ox, oy);
  ctx.fillStyle = pat;
  ctx.fillRect(-TILE, -TILE, w + TILE * 2, h + TILE * 2);
  ctx.restore();
}
