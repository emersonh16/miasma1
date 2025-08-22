// src/world/biomes/mountain.js
// Mountain ground: rocky gray with granite flecks.

let mountainPattern = null;
const TILE = 64;

function ensureMountainPattern(ctx) {
  if (mountainPattern) return mountainPattern;

  const off = document.createElement("canvas");
  off.width = off.height = TILE;
  const o = off.getContext("2d");

  // Base (granite gray)
  o.fillStyle = "#6b6b6b";
  o.fillRect(0, 0, TILE, TILE);

  // Darker clumps
  o.fillStyle = "#4a4a4a";
  for (let i = 0; i < 180; i++) {
    const x = (Math.random() * TILE) | 0;
    const y = (Math.random() * TILE) | 0;
    const r = 1 + ((Math.random() * 2) | 0);
    o.fillRect(x, y, r, r);
  }

  // Lighter flecks
  o.fillStyle = "#9a9a9a";
  for (let i = 0; i < 90; i++) {
    const x = (Math.random() * TILE) | 0;
    const y = (Math.random() * TILE) | 0;
    o.fillRect(x, y, 1, 1);
  }

  mountainPattern = ctx.createPattern(off, "repeat");
  return mountainPattern;
}

export function drawMountainBiome(ctx, cam, w, h) {
  const pat = ensureMountainPattern(ctx);
  const ox = -Math.floor((((cam?.x ?? 0) % TILE) + TILE) % TILE);
  const oy = -Math.floor((((cam?.y ?? 0) % TILE) + TILE) % TILE);

  ctx.save();
  ctx.translate(ox, oy);
  ctx.fillStyle = pat;
  ctx.fillRect(-TILE, -TILE, w + TILE * 2, h + TILE * 2);
  ctx.restore();
}
