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
const MAX_HOLES_PER_FRAME = MC.maxDrawTilesPerFrame ?? 4000; // tune as needed


// ---- State ----
const S = {
  cols: 0,
  rows: 0,
  // top-left world tile of the simulated window
  ox: 0,
  oy: 0,
  // last view dims (in px) so we can adapt on resize
  viewW: 0,
  viewH: 0,
  time: 0,
};

// Cleared fog tiles (relative to current origin): map from key -> timeCleared
const clearedMap = new Map();
const key = (tx, ty) => `${tx},${ty}`;


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
  // account for fog origin
  const k = key(tx - S.ox, ty - S.oy);
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

      const k = key(tx - S.ox, ty - S.oy);
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
  if (_worldMotion) {
    const shiftX = Math.round(_worldMotion.x / TILE_SIZE);
    const shiftY = Math.round(_worldMotion.y / TILE_SIZE);
    if (shiftX || shiftY) {
      S.ox += shiftX;
      S.oy += shiftY;

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


  // Adjacency-based regrow over a WIDER OFFSCREEN area (budgeted + delayed)
  let budget = REGROW_BUDGET;

  // Large scan window in world-tiles (viewport + regrowScanPad)
  const scanPad   = (MC.regrowScanPad ?? (PAD * 4));
  const viewCols  = Math.ceil(viewW / TILE_SIZE);
  const viewRows  = Math.ceil(viewH / TILE_SIZE);

  const scanLeft   = Math.floor((centerWX - viewW / 2) / TILE_SIZE) - scanPad;
  const scanTop    = Math.floor((centerWY - viewH / 2) / TILE_SIZE) - scanPad;
  const scanRight  = scanLeft + viewCols + scanPad * 2;
  const scanBottom = scanTop  + viewRows + scanPad * 2;

  const chance = (MC.regrowChance ?? 0.6) * (MC.regrowSpeedFactor ?? 1);
  const delayS = (MC.regrowDelay ?? 1.0);

  const toGrow = [];

  // Iterate only cleared tiles (much cheaper) and check if they lie inside the scan window
  for (const [k, tCleared] of clearedMap) {
    if (budget <= 0) break;

    const [lx, ly] = k.split(",").map(Number);
    const tx = lx + S.ox;
    const ty = ly + S.oy;
    if (tx < scanLeft || tx >= scanRight || ty < scanTop || ty >= scanBottom) continue;

    if ((S.time - tCleared) < delayS) continue;

    // 4-neighbor fog presence in WORLD tile space
    const nFog =
      (!clearedMap.has(key(tx - 1 - S.ox, ty - S.oy))) ||
      (!clearedMap.has(key(tx + 1 - S.ox, ty - S.oy))) ||
      (!clearedMap.has(key(tx - S.ox, ty - 1 - S.oy))) ||
      (!clearedMap.has(key(tx - S.ox, ty + 1 - S.oy)));

    if (nFog && Math.random() < chance) {
      toGrow.push(k);
      budget--;
    }
  }

  // Apply regrow
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

  // 2) Punch holes for cleared tiles (only those visible)
  ctx.globalCompositeOperation = "destination-out";

  let holes = 0;
  for (let ty = top; ty < bottom; ty++) {
    const y = ty * TILE_SIZE;
    for (let tx = left; tx < right; tx++) {
      const k = key(tx - S.ox, ty - S.oy);
      if (!clearedMap.has(k)) continue; // <-- use clearedMap
      const x = tx * TILE_SIZE;
      ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
      holes++;
      if (holes >= MAX_HOLES_PER_FRAME) break; // stop once budget hit
    }
    if (holes >= MAX_HOLES_PER_FRAME) break;
  }



  // reset comp op
  ctx.globalCompositeOperation = "source-over";
  ctx.restore();
}
