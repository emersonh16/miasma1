// src/systems/miasma/index.js
// Simplified miasma: viewport-aligned grid with persistent cleared tiles.
// - No ring buffer, no offscreen blitting.
// - Density is implicit: a world tile is FOG (1) unless it's in clearedMap (0).
// - Regrow only scans viewport + pad and spreads by adjacency w/ randomness.

import { worldToTile } from "../../core/coords.js";
import { config } from "../../core/config.js";


// ---- Config knobs ----
const MC = (config.miasma ?? {});
const TILE_SIZE = MC.tileSize ?? 8;
const FOG_COLOR = MC.color ?? "rgba(128,0,180,1.0)";   // fully opaque purple
const PAD = MC.regrowPad ?? (MC.marginTiles ?? 6);

// Off-screen behavior (in tiles)
const OFFSCREEN_REG_PAD    = MC.offscreenRegrowPad  ?? (PAD * 6);   // regrow this far past view
const OFFSCREEN_FORGET_PAD = MC.offscreenForgetPad ?? (PAD * 12);  // beyond this, auto-reset

// Perf budgets (dynamic)
let REGROW_BUDGET = 512;
let MAX_HOLES_PER_FRAME = 4000;
let MAX_CLEARED_CAP = 50000;
const CLEARED_TTL_S   = MC.clearedTTL ?? 20; // drop holes older than TTL (seconds)


function updateBudgets(viewW, viewH) {
  const viewCols = Math.ceil(viewW / TILE_SIZE);
  const viewRows = Math.ceil(viewH / TILE_SIZE);
  const screenTiles = viewCols * viewRows;

  // base budgets = ~1× screenful
  REGROW_BUDGET      = Math.max(screenTiles, MC.regrowBudget ?? 512);
  MAX_HOLES_PER_FRAME= Math.max(screenTiles, MC.maxDrawTilesPerFrame ?? 4000);
  MAX_CLEARED_CAP    = Math.max(screenTiles * 4, MC.maxClearedTiles ?? 50000);

  // debug override: crank up
  if (config.flags.devhud) {
    REGROW_BUDGET      *= 4;
    MAX_HOLES_PER_FRAME*= 4;
    MAX_CLEARED_CAP    *= 4;
  }
}


// ---- State ----
const S = {
  cols: 0, rows: 0,
  ox: 0, oy: 0,          // draw window origin (world-aligned)
  viewW: 0, viewH: 0,
  time: 0,
  // Fog phase (in tiles) — where the fog field is relative to world due to wind
  fxTiles: 0, fyTiles: 0,
  // perf stats
  stats: { clearCalls: 0, regrow: 0, drawHoles: 0, forgotOffscreen: 0 }
};




// Cleared fog tiles in ABSOLUTE tile coords: `${tx},${ty}` -> timeCleared
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

export function getStats() {
  return {
    time: S.time,
    clearedMapSize: clearedMap.size,
    lastRegrow: S.stats.regrow,
    lastClearCalls: S.stats.clearCalls,
    lastDrawHoles: S.stats.drawHoles,
    lastForgot: S.stats.forgotOffscreen,
  };
}

export function getBudgets() {
  return {
    regrowBudget: REGROW_BUDGET,
    maxHolesPerFrame: MAX_HOLES_PER_FRAME,
    maxClearedCap: MAX_CLEARED_CAP,
  };
}


// 0 = clear, 1 = fog
export function sample(wx, wy) {
  const [tx, ty] = worldToTile(wx, wy, TILE_SIZE);
  const ftx = Math.floor(tx - S.fxTiles);
  const fty = Math.floor(ty - S.fyTiles);
  return clearedMap.has(key(ftx, fty)) ? 0 : 1;
}


// Circle clear (absolute tile keys)
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
           const ftx = Math.floor(tx - S.fxTiles);
      const fty = Math.floor(ty - S.fyTiles);
      const k = key(ftx, fty);
        if (!clearedMap.has(k)) {
        clearedMap.set(k, S.time);
        cleared++; budget--;
        S.stats.clearCalls++; // PERF: count successful clears
      }
    }
  }
  return cleared;
}

export function update(dt, centerWX, centerWY, _worldMotion = { x:0, y:0 }, viewW = S.viewW, viewH = S.viewH) {
  S.time += dt;

  // reset per-frame stats
  S.stats.clearCalls = 0;
  S.stats.regrow = 0;
  S.stats.drawHoles = 0;
  S.stats.forgotOffscreen = 0;



    // Advect fog by wind (world units → tiles)
  if (_worldMotion) {
    S.fxTiles += (_worldMotion.x || 0) / TILE_SIZE;
    S.fyTiles += (_worldMotion.y || 0) / TILE_SIZE;
  }


  // Keep draw window centered on camera (no rekeying of clearedMap needed)
  if (viewW !== S.viewW || viewH !== S.viewH) {
    init(viewW, viewH, centerWX, centerWY);
  } else {
    const cx = Math.floor(centerWX / TILE_SIZE);
    const cy = Math.floor(centerWY / TILE_SIZE);
    S.ox = cx - Math.floor(S.cols / 2);
    S.oy = cy - Math.floor(S.rows / 2);
  }

    // Recompute budgets to match screen size
  updateBudgets(viewW, viewH);

  let budget = REGROW_BUDGET;


  // --- Regrow within a padded scan window around the view ---
  const scanPad   = (MC.regrowScanPad ?? (PAD * 4));
  const viewCols  = Math.ceil(viewW / TILE_SIZE);
  const viewRows  = Math.ceil(viewH / TILE_SIZE);

  // Base keep (what we absolutely keep scanning every frame)
  const keepLeft   = Math.floor((centerWX - viewW/2) / TILE_SIZE) - scanPad;
  const keepTop    = Math.floor((centerWY - viewH/2) / TILE_SIZE) - scanPad;
  const keepRight  = keepLeft + viewCols + scanPad*2;
  const keepBottom = keepTop  + viewRows + scanPad*2;

  // Extended regrow band (slightly larger off-screen)
  const regLeft    = keepLeft   - OFFSCREEN_REG_PAD;
  const regTop     = keepTop    - OFFSCREEN_REG_PAD;
  const regRight   = keepRight  + OFFSCREEN_REG_PAD;
  const regBottom  = keepBottom + OFFSCREEN_REG_PAD;

  // Far forget band (anything beyond is dropped immediately)
  const forgetLeft   = keepLeft   - Math.max(OFFSCREEN_FORGET_PAD, OFFSCREEN_REG_PAD + PAD);
  const forgetTop    = keepTop    - Math.max(OFFSCREEN_FORGET_PAD, OFFSCREEN_REG_PAD + PAD);
  const forgetRight  = keepRight  + Math.max(OFFSCREEN_FORGET_PAD, OFFSCREEN_REG_PAD + PAD);
  const forgetBottom = keepBottom + Math.max(OFFSCREEN_FORGET_PAD, OFFSCREEN_REG_PAD + PAD);

  const chance = (MC.regrowChance ?? 0.6) * (MC.regrowSpeedFactor ?? 1);
  const delayS = (MC.regrowDelay ?? 1.0);
  const toGrow = [];
  const offX = Math.floor(S.fxTiles), offY = Math.floor(S.fyTiles); // integer fog offset

  // hard cap total entries visited per frame so we don't walk huge maps
  const SCAN_CAP = MC.maxRegrowScanPerFrame ?? 4000;
  let scanned = 0;

  for (const [k, tCleared] of clearedMap) {
    if (budget <= 0 || scanned >= SCAN_CAP) break;
    scanned++;

    // Fog-space coords
    const [fx, fy] = k.split(",").map(Number);

    const tx = fx + offX;
    const ty = fy + offY;

    // Far outside? forget immediately so wind can't bring it back
    if (tx < forgetLeft || tx >= forgetRight || ty < forgetTop || ty >= forgetBottom) {
      clearedMap.delete(k);
      S.stats.forgotOffscreen++;
      continue;
    }

    // Outside extended regrow band? skip (neither grow nor delete)
    if (tx < regLeft || tx >= regRight || ty < regTop || ty >= regBottom) continue;


    if ((S.time - tCleared) < delayS) continue;

    // Neighbor fog in fog‑space
    const nFog =
      (!clearedMap.has(key(fx - 1, fy    ))) ||
      (!clearedMap.has(key(fx + 1, fy    ))) ||
      (!clearedMap.has(key(fx,     fy - 1))) ||
      (!clearedMap.has(key(fx,     fy + 1)));

    if (nFog && Math.random() < chance) { toGrow.push(k); budget--; }
  }


  for (const k of toGrow) clearedMap.delete(k);
  S.stats.regrow = toGrow.length;


  // --- Aging & safety cap (keeps long runs stable) ---
  if (clearedMap.size) {
    const nowT = S.time;

    // TTL: drop entries older than TTL seconds
    if (CLEARED_TTL_S > 0) {
      for (const [k, tCleared] of clearedMap) {
        if (nowT - tCleared > CLEARED_TTL_S) clearedMap.delete(k);
      }
    }

    // Hard cap: drop oldest if we explode beyond cap
    if (clearedMap.size > MAX_CLEARED_CAP) {
      const overflow = clearedMap.size - MAX_CLEARED_CAP;
      let scanned = 0, removed = 0;
      const candidates = [];
      for (const [k, tCleared] of clearedMap) {
        candidates.push([k, tCleared]);
        if (++scanned >= Math.min(clearedMap.size, overflow * 2)) break;
      }
      candidates.sort((a, b) => a[1] - b[1]); // oldest first
      for (let i = 0; i < candidates.length && removed < overflow; i++) {
        clearedMap.delete(candidates[i][0]);
        removed++;
      }
    }
  }
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

  // 2) Punch visible holes (absolute tile coords) — RLE rows
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();

  const offX = Math.floor(S.fxTiles), offY = Math.floor(S.fyTiles);
  const rows = new Map(); // ty -> number[] of tx

  // Bucket visible tiles by row
  for (const k of clearedMap.keys()) {
    const [fx, fy] = k.split(",").map(Number);
    const tx = fx + offX;
    const ty = fy + offY;
    if (tx < left || tx >= right || ty < top || ty >= bottom) continue;
    let xs = rows.get(ty);
    if (!xs) { xs = []; rows.set(ty, xs); }
    xs.push(tx);
  }

  // Build rects per row by merging contiguous runs
  let tilesDrawn = 0;
  for (const [ty, xs] of rows) {
    xs.sort((a,b) => a - b);
    let runStart = null, prev = null;
    for (let i = 0; i < xs.length; i++) {
      const x = xs[i];
      if (runStart === null) { runStart = prev = x; continue; }
      if (x === prev + 1) { prev = x; continue; }

      // flush run
      const runLen = prev - runStart + 1;
      ctx.rect(runStart * TILE_SIZE, ty * TILE_SIZE, runLen * TILE_SIZE, TILE_SIZE);
      tilesDrawn += runLen;
      if (tilesDrawn >= MAX_HOLES_PER_FRAME) break;

      runStart = prev = x;
    }
    if (tilesDrawn >= MAX_HOLES_PER_FRAME) break;
    if (runStart !== null) {
      const runLen = prev - runStart + 1;
      ctx.rect(runStart * TILE_SIZE, ty * TILE_SIZE, runLen * TILE_SIZE, TILE_SIZE);
      tilesDrawn += runLen;
      if (tilesDrawn >= MAX_HOLES_PER_FRAME) break;
    }
  }
  if (tilesDrawn > 0) ctx.fill();
  S.stats.drawHoles = tilesDrawn;

  // restore normal blending & transform for the rest of the frame
  ctx.globalCompositeOperation = "source-over";
  ctx.restore();
}
