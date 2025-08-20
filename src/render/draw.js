// src/render/draw.js
import { config } from "../core/config.js";

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
  o.fillStyle = "#5e4a28";
  o.fillRect(0, 0, earthSize, earthSize);

  // Darker noise clumps
  o.fillStyle = "#4a3820";
  for (let i = 0; i < 180; i++) {
    const x = Math.floor(rand() * earthSize);
    const y = Math.floor(rand() * earthSize);
    const r = 1 + Math.floor(rand() * 2);
    o.fillRect(x, y, r, r);
  }

  // Lighter flecks
  o.fillStyle = "#705733";
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

  // World anchored: offset pattern by camera position
  const pat = ensureEarthPattern(ctx);
const ox = -Math.floor(mod(cam?.x ?? 0, earthSize));
const oy = -Math.floor(mod(cam?.y ?? 0, earthSize));

  ctx.save();
  ctx.translate(ox, oy);
  ctx.fillStyle = pat;
  // Pad fill to hide seams when translating
  ctx.fillRect(-earthSize, -earthSize, w + earthSize * 2, h + earthSize * 2);
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
