// src/systems/miasma/index.js
// Simplified miasma: viewport-aligned grid with persistent cleared tiles.
// - No ring buffer, no offscreen blitting.
// - Density is implicit: a world tile is FOG (1) unless it's in clearedTiles (0).
// - Regrow only scans viewport + pad and spreads by adjacency w/ randomness.

import { worldToTile } from "../../core/coords.js";
import { config } from "../../core/config.js";

// ---- Config knobs ----
const MC = (config.miasma ?? {});
const TILE_SIZE = MC.tileSize ?? 8;
const FOG_COLOR = MC.color ?? "rgba(128,0,180,1.0)";   // fully opaque purple
const PAD = MC.regrowPad ?? (MC.marginTiles ?? 6);
const REGROW_CHANCE = MC.regrowChance ?? 0.6;
const REGROW_BUDGET = MC.regrowBudget ??
  Math.floor((MC.maxTilesUpdatedPerTick ?? config.maxTilesUpdatedPerTick ?? 256) / 2);
const MAX_HOLES_PER_FRAME = MC.maxDrawTilesPerFrame ?? 4000;

// ---- State ----
const S = {
  cols: 0, rows: 0,
  ox: 0, oy: 0,
  accTilesX: 0, accTilesY: 0,
  viewW: 0, viewH: 0,
  time: 0,
};

// Cleared fog tiles (relative to current origin): map from key -> timeCleared
const clearedMap = new Map();
const key = (tx, ty) => `${tx},${ty}`;

// ---- API ----
export function init(viewW, viewH, centerWX = 0, centerWY = 0) {
  S.viewW = viewW; S.viewH = viewH;
  const viewCols = Math.ceil(viewW / TILE_SIZE);
  const viewRows = Math.ceil(viewH / TILE_SIZE);
  S.cols = viewCols + PAD * 2;
  S.rows = viewRows + PAD * 2;

  const cx = Math.floor(centerWX / TILE_SIZE);
  const cy = Math.floor(centerWY / TILE_SIZE);
  S.ox = cx - Math.floor(S.cols / 2);
  S.oy = cy - Math.floor(S.rows / 2);
  S.time = 0;
}

export function getTileSize() { return TILE_SIZE; }
export function getOrigin()   { return { ox: S.ox, oy: S.oy }; }

export function sample(wx, wy) {
  const [tx, ty] = worldToTile(wx, wy, TILE_SIZE);
  const k = key(tx - S.ox, ty - S.oy);
  return clearedMap.has(k) ? 0 : 1;
}

// Circle clear
export function clearArea(wx, wy, r, _amt = 64) {
  const [cx, cy] = worldToTile(wx, wy, TILE_SIZE);
  const tr = Math.ceil(r / TILE_SIZE);
  const r2 = r * r;
  let cleared = 0;
  let budget = Math.min(
    _amt,
    (MC.maxTilesUpdatedPerTick ?? config.maxTilesUpdatedPerTick ?? 256)
  );

  for (let dy = -tr; dy <= tr && budget > 0; dy++) {
    for (let dx = -tr; dx <= tr && budget > 0; dx++) {
      const tx = cx + dx, ty = cy + dy;
      const centerX = (tx + 0.5) * TILE_SIZE;
      const centerY = (ty + 0.5) * TILE_SIZE;
      const dxw = centerX - wx, dyw = centerY - wy;
      if ((dxw * dxw + dyw * dyw) > r2) continue;
      const k = key(tx - S.ox, ty - S.oy);
      if (!clearedMap.has(k)) {
        clearedMap.set(k, S.time);
        cleared++; budget--;
      }
    }
  }
  return cleared;
}

export function update(dt, centerWX, centerWY, _worldMotion = { x:0, y:0 }, viewW = S.viewW, viewH = S.viewH) {
  S.time += dt;

  if (viewW !== S.viewW || viewH !== S.viewH) {
    init(viewW, viewH, centerWX, centerWY);
  } else {
    const cx = Math.floor(centerWX / TILE_SIZE);
    const cy = Math.floor(centerWY / TILE_SIZE);
    S.ox = cx - Math.floor(S.cols / 2);
    S.oy = cy - Math.floor(S.rows / 2);
  }

  // World motion → shift origin
  if (_worldMotion) {
    S.accTilesX += _worldMotion.x / TILE_SIZE;
    S.accTilesY += _worldMotion.y / TILE_SIZE;
    const takeInt = (v) => (v >= 0 ? Math.floor(v) : Math.ceil(v));
    const shiftX = takeInt(S.accTilesX), shiftY = takeInt(S.accTilesY);
    if (shiftX || shiftY) {
      S.accTilesX -= shiftX; S.accTilesY -= shiftY;
      S.ox += shiftX; S.oy += shiftY;

      if (clearedMap.size) {
        const shifted = new Map();
        for (const [k, v] of clearedMap) {
          const [lx, ly] = k.split(",").map(Number);
          shifted.set(key(lx - shiftX, ly - shiftY), v);
        }
        clearedMap.clear();
        for (const [k, v] of shifted) clearedMap.set(k, v);
      }
    }
  }

  // Regrow
  let budget = REGROW_BUDGET;
  const scanPad   = (MC.regrowScanPad ?? (PAD * 4));
  const viewCols  = Math.ceil(viewW / TILE_SIZE);
  const viewRows  = Math.ceil(viewH / TILE_SIZE);
  const keepLeft   = Math.floor((centerWX - viewW/2) / TILE_SIZE) - scanPad;
  const keepTop    = Math.floor((centerWY - viewH/2) / TILE_SIZE) - scanPad;
  const keepRight  = keepLeft + viewCols + scanPad*2;
  const keepBottom = keepTop  + viewRows + scanPad*2;

  const chance = (MC.regrowChance ?? 0.6) * (MC.regrowSpeedFactor ?? 1);
  const delayS = (MC.regrowDelay ?? 1.0);
  const toGrow = [];
  for (const [k, tCleared] of clearedMap) {
    if (budget <= 0) break;
    const [lx, ly] = k.split(",").map(Number);
    const tx = lx + S.ox, ty = ly + S.oy;
    if (tx < keepLeft || tx >= keepRight || ty < keepTop || ty >= keepBottom) continue;
    if ((S.time - tCleared) < delayS) continue;
    const nFog =
      (!clearedMap.has(key(tx - 1 - S.ox, ty - S.oy))) ||
      (!clearedMap.has(key(tx + 1 - S.ox, ty - S.oy))) ||
      (!clearedMap.has(key(tx - S.ox, ty - 1 - S.oy))) ||
      (!clearedMap.has(key(tx - S.ox, ty + 1 - S.oy)));
    if (nFog && Math.random() < chance) { toGrow.push(k); budget--; }
  }
  for (const k of toGrow) clearedMap.delete(k);
}

export function draw(ctx, cam, w, h) {
  ctx.save();
  ctx.translate(-cam.x + w/2, -cam.y + h/2);

  const viewCols = Math.ceil(w / TILE_SIZE);
  const viewRows = Math.ceil(h / TILE_SIZE);
  const left   = Math.floor((cam.x - w/2) / TILE_SIZE) - PAD;
  const top    = Math.floor((cam.y - h/2) / TILE_SIZE) - PAD;
  const right  = left + viewCols + PAD*2;
  const bottom = top  + viewRows + PAD*2;

  const pxLeft   = left   * TILE_SIZE;
  const pxTop    = top    * TILE_SIZE;
  const pxWidth  = (right - left) * TILE_SIZE;
  const pxHeight = (bottom - top) * TILE_SIZE;

  // 1) Solid purple fog fill
  ctx.fillStyle = FOG_COLOR;
  ctx.fillRect(pxLeft, pxTop, pxWidth, pxHeight);

  // 2) Punch visible holes
  ctx.globalCompositeOperation = "destination-out";
  let holes=0;
  ctx.beginPath();
  for (const k of clearedMap.keys()) {
    const [lx, ly] = k.split(",").map(Number);
    const tx = lx + S.ox, ty = ly + S.oy;
    if (tx < left || tx >= right || ty < top || ty >= bottom) continue;
    ctx.rect(tx*TILE_SIZE, ty*TILE_SIZE, TILE_SIZE, TILE_SIZE);
    if (++holes >= MAX_HOLES_PER_FRAME) break;
  }
  if (holes>0) ctx.fill();
  ctx.globalCompositeOperation = "source-over";
  ctx.restore();
}
