// src/world/biomes/ice.js
// World‑anchored ICE ground: crisp Moebius‑y cyan/blue speckle pattern.

let icePattern = null;
let TILE = 64;

function ensureIcePattern(ctx) {
  if (icePattern) return icePattern;

  const off = document.createElement("canvas");
  off.width = off.height = TILE;
  const o = off.getContext("2d");

  // Base ice color (soft cyan)
  o.fillStyle = "#5bd9e2ff";
  o.fillRect(0, 0, TILE, TILE);

  // Darker noise clumps
  o.fillStyle = "#1cacc5ff";
  for (let i = 0; i < 180; i++) {
    const x = (Math.random() * TILE) | 0;
    const y = (Math.random() * TILE) | 0;
    const r = 1 + ((Math.random() * 2) | 0);
    o.fillRect(x, y, r, r);
  }

  // Lighter flecks
  o.fillStyle = "#9ae2ffff";
  for (let i = 0; i < 90; i++) {
    const x = (Math.random() * TILE) | 0;
    const y = (Math.random() * TILE) | 0;
    o.fillRect(x, y, 1, 1);
  }

  icePattern = ctx.createPattern(off, "repeat");
  return icePattern;
}

export function drawIceBiome(ctx, cam, w, h) {
  const pat = ensureIcePattern(ctx);
  const ox = -Math.floor(((cam?.x ?? 0) % TILE + TILE) % TILE);
  const oy = -Math.floor(((cam?.y ?? 0) % TILE + TILE) % TILE);

  ctx.save();
  ctx.translate(ox, oy);
  ctx.fillStyle = pat;
  // pad a bit to avoid seams
  ctx.fillRect(-TILE, -TILE, w + TILE * 2, h + TILE * 2);
  ctx.restore();
}
