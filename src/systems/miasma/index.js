// Simplified miasma: viewport-aligned grid with persistent cleared tiles.
// - No ring buffer, no offscreen blitting.
// - Density is implicit: a world tile is FOG (1) unless it's in clearedTiles (0).
// - Regrow only scans viewport + pad and spreads by adjacency w/ randomness.

import { worldToTile } from "../../core/coords.js";
import { config } from "../../core/config.js";

// ---- Config knobs ----
const MC = (config.miasma ?? {});
const TILE_SIZE = MC.tileSize ?? 8;                       // keep ≥8 for perf
const FOG_COLOR = MC.color ?? "rgba(128,0,180,0.35)";
const PAD = MC.regrowPad ?? (MC.marginTiles ?? 6);        // tiles beyond view
const REGROW_CHANCE = MC.regrowChance ?? 0.6;             // 0..1
const REGROW_BUDGET = MC.regrowBudget ??
  Math.floor((MC.maxTilesUpdatedPerTick ?? config.maxTilesUpdatedPerTick ?? 256) / 2);
const PRUNE_BUDGET = MC.pruneBudget ?? 128;               // tiles pruned per frame
const MAX_HOLES_PER_FRAME = MC.maxDrawTilesPerFrame ?? 4000; // tune as needed


// ---- State ----
const S = {
  cols: 0,
  rows: 0,
  // top-left world tile of the simulated window
  ox: 0,
  oy: 0,
  // carry fractional motion between frames (in tiles)
  accTilesX: 0,
  accTilesY: 0,
  // last view dims (in px) so we can adapt on resize
  viewW: 0,
  viewH: 0,
  time: 0,
};


// Cleared fog tiles keyed by world tile coords (packed into a bigint)
const clearedMap = new Map(); // Map<bigint, number>
const key = (tx, ty) => (BigInt(tx) << 32n) | (BigInt(ty) & 0xffffffffn);
const unpack = (k) => {
  let ty = Number(k & 0xffffffffn);
  if (ty >= 0x80000000) ty -= 0x100000000;
  let tx = Number(k >> 32n);
  if (tx >= 0x80000000) tx -= 0x100000000;
  return [tx, ty];
};


// ---- API ----
export function init(viewW, viewH, centerWX = 0, centerWY = 0) {
  S.viewW = viewW;
  S.viewH = viewH;
  const viewCols = Math.ceil(viewW / TILE_SIZE);
  const viewRows = Math.ceil(viewH / TILE_SIZE);
  S.cols = viewCols + PAD * 2;
  S.rows = viewRows + PAD * 2;

  // center the simulated window on camera (in tile space)
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
  const k = key(tx, ty);
  return clearedMap.has(k) ? 0 : 1;
}


// Circle clear using world distance to tile centers → accurate hitbox alignment
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

      // world distance to tile center
      const centerX = (tx + 0.5) * TILE_SIZE;
      const centerY = (ty + 0.5) * TILE_SIZE;
      const dxw = centerX - wx;
      const dyw = centerY - wy;
      if ((dxw * dxw + dyw * dyw) > r2) continue;

      const k = key(tx, ty);
      if (!clearedMap.has(k)) {
        clearedMap.set(k, S.time); // record clear time in seconds
        cleared++;
        budget--;
      }

    }
  }
  return cleared;
}

export function update(dt, centerWX, centerWY, _worldMotion = { x: 0, y: 0 }, viewW = S.viewW, viewH = S.viewH) {
  S.time += dt;

  // Recompute window dims if view changed
  if (viewW !== S.viewW || viewH !== S.viewH) {
    init(viewW, viewH, centerWX, centerWY);
  } else {
    // Recenter simulated window on camera
    const cx = Math.floor(centerWX / TILE_SIZE);
    const cy = Math.floor(centerWY / TILE_SIZE);
    S.ox = cx - Math.floor(S.cols / 2);
    S.oy = cy - Math.floor(S.rows / 2);
  }

  // Apply world motion (camera delta + wind drift) to fog origin
  // Accumulate sub-tile motion so direction is truly 360° and speed isn't quantized per-frame.
  if (_worldMotion) {
    // accumulate in TILE units
    S.accTilesX += _worldMotion.x / TILE_SIZE;
    S.accTilesY += _worldMotion.y / TILE_SIZE;

    // take whole-tile steps (handle negatives correctly)
    const takeInt = (v) => (v >= 0 ? Math.floor(v) : Math.ceil(v));
    const shiftX = takeInt(S.accTilesX);
    const shiftY = takeInt(S.accTilesY);

    if (shiftX || shiftY) {
      // keep the fractional remainder
      S.accTilesX -= shiftX;
      S.accTilesY -= shiftY;

      S.ox += shiftX;
      S.oy += shiftY;
    }
  }


  // ---- Opportunistic prune so the map doesn't balloon as you travel ----
  // Keep only a wide window around the camera (viewport + regrowScanPad)
  const scanPad   = (MC.regrowScanPad ?? (PAD * 4));
  const viewCols  = Math.ceil(viewW / TILE_SIZE);
  const viewRows  = Math.ceil(viewH / TILE_SIZE);

  const keepLeft   = Math.floor((centerWX - viewW / 2) / TILE_SIZE) - scanPad;
  const keepTop    = Math.floor((centerWY - viewH / 2) / TILE_SIZE) - scanPad;
  const keepRight  = keepLeft + viewCols + scanPad * 2;
  const keepBottom = keepTop  + viewRows + scanPad * 2;

 let pruneBudget = PRUNE_BUDGET;
  for (const k of clearedMap.keys()) {
    if (pruneBudget <= 0) break;
    const [tx, ty] = unpack(k);
    if (tx < keepLeft || tx >= keepRight || ty < keepTop || ty >= keepBottom) {
      clearedMap.delete(k);
      pruneBudget--;
    }
  }

  // ---- Adjacency-based regrow (budgeted + delayed) ----
  let budget = REGROW_BUDGET;
  const scanLeft   = keepLeft;
  const scanTop    = keepTop;
  const scanRight  = keepRight;
  const scanBottom = keepBottom;

  const chance = (MC.regrowChance ?? 0.6) * (MC.regrowSpeedFactor ?? 1);
  const delayS = (MC.regrowDelay ?? 1.0);

  const toGrow = [];
  for (const [k, tCleared] of clearedMap) {
    if (budget <= 0) break;

    const [tx, ty] = unpack(k);
    if (tx < scanLeft || tx >= scanRight || ty < scanTop || ty >= scanBottom) continue;

    if ((S.time - tCleared) < delayS) continue;

    const nFog =
      (!clearedMap.has(key(tx - 1, ty))) ||
      (!clearedMap.has(key(tx + 1, ty))) ||
      (!clearedMap.has(key(tx, ty - 1))) ||
      (!clearedMap.has(key(tx, ty + 1)));

    if (nFog && Math.random() < chance) {
      toGrow.push(k);
      budget--;
    }
  }
  for (const k of toGrow) clearedMap.delete(k);
}


export function draw(ctx, cam, w, h) {
  ctx.save();
  ctx.translate(-cam.x + w / 2, -cam.y + h / 2);

  // Padded viewport in tile coords
  const viewCols = Math.ceil(w / TILE_SIZE);
  const viewRows = Math.ceil(h / TILE_SIZE);
  const left   = Math.floor((cam.x - w / 2) / TILE_SIZE) - PAD;
  const top    = Math.floor((cam.y - h / 2) / TILE_SIZE) - PAD;
  const right  = left + viewCols + PAD * 2;
  const bottom = top  + viewRows + PAD * 2;

  // 1) Paint one big fog rect (fast)
  ctx.fillStyle = FOG_COLOR;
  ctx.fillRect(left * TILE_SIZE, top * TILE_SIZE,
               (right - left) * TILE_SIZE, (bottom - top) * TILE_SIZE);

  // 2) Punch visible holes only, in one path
  ctx.globalCompositeOperation = "destination-out";

  let holes = 0;
  ctx.beginPath();
  for (const k of clearedMap.keys()) {
    const [tx, ty] = unpack(k);
    if (tx < left || tx >= right || ty < top || ty >= bottom) continue;

    ctx.rect(tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    holes++;
    if (holes >= MAX_HOLES_PER_FRAME) break;
  }
  if (holes > 0) ctx.fill();

  // reset comp op
  ctx.globalCompositeOperation = "source-over";
  ctx.restore();
}
