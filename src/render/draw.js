// src/render/draw.js
import { config } from "../core/config.js";
import { getGroundColor, getBiomeId } from "../world/biomes/index.js";
import { drawIceBiome } from "../world/biomes/ice.js";
import { getTile, TILE_SIZE as WORLD_T } from "../world/store.js";


// --- tiny utils ---
function mod(n, m) { return ((n % m) + m) % m; }

// --- World‑aligned ground pattern (generated once) ---
let earthPattern = null;
let earthSize = 64;

function ensureEarthPattern(ctx) {
  if (earthPattern) return earthPattern;

  // Use same scale as world tiles for nice alignment.
  earthSize = 64;

  const off = document.createElement("canvas");
  off.width = off.height = earthSize;
  const o = off.getContext("2d");

  // Deterministic speckled dirt using seed
  function mulberry32(a) {
    return function() {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rand = mulberry32((config.seed ?? 1337) ^ 0x9e3779b9);

  // Base soil
  o.fillStyle = "#5bd9e2ff";
  o.fillRect(0, 0, earthSize, earthSize);

  // Darker noise clumps
  o.fillStyle = "#1cacc5ff";
  for (let i = 0; i < 180; i++) {
    const x = Math.floor(rand() * earthSize);
    const y = Math.floor(rand() * earthSize);
    const r = 1 + Math.floor(rand() * 2);
    o.fillRect(x, y, r, r);
  }

  // Lighter flecks
  o.fillStyle = "#9ae2ffff";
  for (let i = 0; i < 90; i++) {
    const x = Math.floor(rand() * earthSize);
    const y = Math.floor(rand() * earthSize);
    o.fillRect(x, y, 1, 1);
  }

  earthPattern = ctx.createPattern(off, "repeat");
  return earthPattern;
}

/**
 * Clear + draw world‑aligned ground that scrolls underfoot.
 * NOTE: pass the camera so the pattern is anchored to WORLD, not screen.
 */
export function clear(ctx, w, h, cam) {
  ctx.clearRect(0, 0, w, h);

  // Route by active biome. "ice" uses the preserved pattern; others = flat color fill.
  const id = getBiomeId();
  if (id === "ice") {
    drawIceBiome(ctx, cam, w, h);
    return;
  }

  // Flat color fill for simple MVP biomes
  ctx.save();
  ctx.fillStyle = getGroundColor();
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}


/**
 * World‑aligned grid that scrolls under the player.
 * Call AFTER translating to world space (w/2, h/2).
 */
export function drawGrid(ctx, cam, w, h, cell = 64) {
  const halfW = w / 2;
  const halfH = h / 2;

  // Offset grid by camera position so it scrolls opposite to movement.
  const startX = -halfW - (cam.x % cell);
  const startY = -halfH - (cam.y % cell);

  ctx.save();
  ctx.lineWidth = 1;

  // Base grid
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  for (let x = startX; x <= halfW; x += cell) {
    ctx.beginPath();
    ctx.moveTo(x, -halfH);
    ctx.lineTo(x, halfH);
    ctx.stroke();
  }
  for (let y = startY; y <= halfH; y += cell) {
    ctx.beginPath();
    ctx.moveTo(-halfW, y);
    ctx.lineTo(halfW, y);
    ctx.stroke();
  }

  ctx.restore();
}


/**
 * Draw world-anchored ROCK tiles as chunky pixels.
 * Uses world tile size (WORLD_T), which is an exact multiple of the fog pixel size,
 * so edges land on the same pixel grid and stay razor-sharp.
 */
export function drawRocks(ctx, cam, w, h) {
  const halfW = w / 2, halfH = h / 2;

  // Visible world tile window
  const leftTile   = Math.floor((cam.x - halfW) / WORLD_T);
  const topTile    = Math.floor((cam.y - halfH) / WORLD_T);
  const rightTile  = Math.floor((cam.x + halfW)  / WORLD_T);
  const bottomTile = Math.floor((cam.y + halfH)  / WORLD_T);

  ctx.save();
  // Translate to world space (player at screen center)
  ctx.translate(halfW, halfH);

  // Solid rock fill — earthy gray/brown (tweak later)
  ctx.fillStyle = "#8bd8fcff";

  for (let ty = topTile; ty <= bottomTile; ty++) {
    for (let tx = leftTile; tx <= rightTile; tx++) {
      const wx = tx * WORLD_T;
      const wy = ty * WORLD_T;
      const t = getTile(wx + 1, wy + 1); // +1 to sample inside the tile
      if (!t?.solid) continue;

      // World→screen rect aligned to pixel grid
      const sx = Math.floor(wx - cam.x);
      const sy = Math.floor(wy - cam.y);
      ctx.fillRect(sx, sy, WORLD_T, WORLD_T);
    }
  }
  ctx.restore();
}
