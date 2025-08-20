// Simplified miasma: viewport-aligned grid with persistent cleared tiles.
// - No ring buffer, no offscreen blitting.
// - Density is implicit: a world tile is FOG (1) unless it's in clearedTiles (0).
// - Regrow only scans viewport + pad and spreads by adjacency w/ randomness.

import { worldToTile, mod } from "../../core/coords.js";
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

// Persistently cleared world tiles (by world tile coords)
const clearedTiles = new Set();
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
  // fog unless persistently cleared
  return clearedTiles.has(key(tx, ty)) ? 0 : 1;
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
      if (!clearedTiles.has(k)) {
        clearedTiles.add(k);
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

  // Adjacency-based regrow (viewport + PAD), budget-limited & random
  let budget = REGROW_BUDGET;
  const viewCols = Math.ceil(viewW / TILE_SIZE);
  const viewRows = Math.ceil(viewH / TILE_SIZE);

  const left   = Math.floor((centerWX - viewW / 2) / TILE_SIZE) - PAD;
  const top    = Math.floor((centerWY - viewH / 2) / TILE_SIZE) - PAD;
  const right  = left + viewCols + PAD * 2;
  const bottom = top  + viewRows + PAD * 2;

  const toGrow = [];

  for (let ty = top; ty < bottom && budget > 0; ty++) {
    for (let tx = left; tx < right && budget > 0; tx++) {
      const k = key(tx, ty);
      // only consider cleared tiles (0) for regrow
      if (!clearedTiles.has(k)) continue;

      // 4-neighbor check in *world tile* space
      const nFog =
        (!clearedTiles.has(key(tx - 1, ty))) ||
        (!clearedTiles.has(key(tx + 1, ty))) ||
        (!clearedTiles.has(key(tx, ty - 1))) ||
        (!clearedTiles.has(key(tx, ty + 1)));

      if (nFog && Math.random() < REGROW_CHANCE) {
        toGrow.push(k);
        budget--;
      }
    }
  }

  // apply regrow
  for (const k of toGrow) clearedTiles.delete(k);
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
      if (!clearedTiles.has(key(tx, ty))) continue;
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
