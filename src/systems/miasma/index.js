// src/systems/miasma/index.js
// Simplified miasma: viewport-aligned grid with persistent cleared tiles.
// - No ring buffer, no offscreen blitting.
// - Density is implicit: a world tile is FOG (1) unless it's in clearedMap (0).
// - Regrow only scans viewport + pad and spreads by adjacency w/ randomness.

import { worldToTile, mod } from "../../core/coords.js";
import { config } from "../../core/config.js";

// ---- Config knobs ----
const MC = (config.miasma ?? {});
const TILE_SIZE = MC.tileSize ?? 8;
const FOG_COLOR = MC.color ?? "rgba(128,0,180,1.0)";   // fully opaque purple
const PAD = MC.regrowPad ?? (MC.marginTiles ?? 6);

// Edge‑rim glow (PR2)
const RIM_TTL_S    = (MC.rimTTL ?? 0.60);              // ↑ longer so it’s obvious
const RIM_COLOR    = (MC.rimColor ?? "#ffffff");       // ↑ bright white to confirm it works
const RIM_WIDTH    = (MC.rimWidth ?? 1.5);             // ↑ slightly thicker
const RIM_MAX_PERF = (MC.rimMaxPerFrame ?? 3000);      // cap strokes per frame



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
const frontier = new Set();
const key = (tx, ty) => `${tx},${ty}`;

function isBoundary(fx, fy) {
  return (
    !clearedMap.has(key(fx - 1, fy)) ||
    !clearedMap.has(key(fx + 1, fy)) ||
    !clearedMap.has(key(fx, fy - 1)) ||
    !clearedMap.has(key(fx, fy + 1))
  );
}

function checkFrontier(fx, fy) {
  const k = key(fx, fy);
  if (!clearedMap.has(k)) {
    frontier.delete(k);
    return;
  }
  if (isBoundary(fx, fy)) frontier.add(k);
  else frontier.delete(k);
}

function updateNeighbors(fx, fy) {
  checkFrontier(fx - 1, fy);
  checkFrontier(fx + 1, fy);
  checkFrontier(fx, fy - 1);
  checkFrontier(fx, fy + 1);
}

function removeClearedKey(k) {
  if (!clearedMap.has(k)) {
    frontier.delete(k);
    return;
  }
  clearedMap.delete(k);
  frontier.delete(k);
  const [fx, fy] = k.split(",").map(Number);
  updateNeighbors(fx, fy);
}

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
        checkFrontier(ftx, fty);
        updateNeighbors(ftx, fty);
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
  const toForget = [];
  const offX = Math.floor(S.fxTiles), offY = Math.floor(S.fyTiles); // integer fog offset

  // hard cap total entries visited per frame so we don't walk huge maps
  const SCAN_CAP = MC.maxRegrowScanPerFrame ?? 4000;
  let scanned = 0;

  for (const k of frontier) {
    if (budget <= 0 || scanned >= SCAN_CAP) break;
    scanned++;

    const tCleared = clearedMap.get(k);
    if (tCleared === undefined) { frontier.delete(k); continue; }

    const [fx, fy] = k.split(",").map(Number);
    const tx = fx + offX;
    const ty = fy + offY;

    // Far outside? forget immediately so wind can't bring it back
    if (tx < forgetLeft || tx >= forgetRight || ty < forgetTop || ty >= forgetBottom) {
      toForget.push(k);
      S.stats.forgotOffscreen++;
      continue;
    }

    // Outside extended regrow band? skip (neither grow nor delete)
    if (tx < regLeft || tx >= regRight || ty < regTop || ty >= regBottom) continue;

    if (!isBoundary(fx, fy)) { frontier.delete(k); continue; }

    if ((S.time - tCleared) < delayS) continue;

    if (Math.random() < chance) { toGrow.push(k); budget--; }
  }

  for (const k of toForget) removeClearedKey(k);
  for (const k of toGrow) removeClearedKey(k);
  S.stats.regrow = toGrow.length;


  // --- Aging & safety cap (keeps long runs stable) ---
  if (clearedMap.size) {
    const nowT = S.time;

    // TTL: drop entries older than TTL seconds
    if (CLEARED_TTL_S > 0) {
      for (const [k, tCleared] of clearedMap) {
        if (nowT - tCleared > CLEARED_TTL_S) removeClearedKey(k);
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
        removeClearedKey(candidates[i][0]);
        removed++;
      }
    }
  }
}

// --- PR1: lightweight shimmer layer (cached patterns; wind‑driven parallax) ---
// 1) Config (must be BEFORE drawShimmer)
const SHIM = (() => {
  const cfg = (MC.shimmer ?? {});
  return {
    enabled: cfg.enabled ?? true,
    alpha:   cfg.alpha   ?? 0.18,  // overall shimmer strength
    layers: [
      { size: cfg.size0 ?? 64, speed: cfg.speed0 ?? 0.0, parallax: cfg.parallax0 ?? 0.55 },
      { size: cfg.size1 ?? 96, speed: cfg.speed1 ?? 0.0, parallax: cfg.parallax1 ?? 0.85 },
    ],
  };
})();

// 2) Pattern cache + maker (one per size)
const _patCache = new Map();
function ensurePattern(ctx, size) {
  const key = size | 0;
  let pat = _patCache.get(key);
  if (pat) return pat;

  const off = document.createElement("canvas");
  off.width = off.height = key;
  const o = off.getContext("2d", { alpha: true });

  // Crystal‑ish palette: deep amethyst base + aqua flecks
  o.fillStyle = "#501a70";            // body
  o.fillRect(0, 0, key, key);

  o.globalAlpha = 0.12;               // blotchy caustics
  for (let i = 0; i < key * 0.7; i++) {
    const r = 2 + ((i * 7) % 5);
    o.beginPath();
    o.arc((i * 37) % key, (i * 19) % key, r, 0, Math.PI * 2);
    o.fillStyle = "#7e49b8";
    o.fill();
  }

  o.globalAlpha = 0.22;               // brighter flecks
  for (let i = 0; i < key * 0.35; i++) {
    o.fillStyle = (i % 3) ? "#4be2ff" : "#9be7ff";
    o.fillRect((i * 53) % key, (i * 29) % key, 1, 1);
  }

  pat = ctx.createPattern(off, "repeat");
  _patCache.set(key, pat);
  return pat;
}


/** Draw shimmer over fog body; centered on viewport/player, drawn BEFORE holes */
function drawShimmer(ctx, cam, w, h) {
  if (!SHIM.enabled || SHIM.alpha <= 0) return;

  // Wind phase in pixels (from update())
  const windPXx = S.fxTiles * TILE_SIZE;
  const windPXy = S.fyTiles * TILE_SIZE;
  const t = S.time;

  for (let i = 0; i < SHIM.layers.length; i++) {
    const L = SHIM.layers[i];
    const size = Math.max(16, L.size | 0);
    const par  = Math.max(0, Math.min(1, Number(L.parallax) || 0.5));
    const pat  = ensurePattern(ctx, size);

    // Subtle extra drift (still cheap) when wind is calm
    const driftX = (L.speed || 0) * t * 0.5;
    const driftY = (L.speed || 0) * t * 0.35;

    // Anchor pattern phase to the CAMERA CENTER in WORLD space.
    // IMPORTANT: draw() has already translated the ctx by (-cam.x + w/2, -cam.y + h/2),
    // so here we stay in world coords (no extra screen-center translation).
    const phaseX = -Math.floor(mod(cam.x + windPXx * par + driftX, size));
    const phaseY = -Math.floor(mod(cam.y + windPXy * par + driftY, size));

    ctx.save();
    ctx.globalAlpha = SHIM.alpha * (1 + 0.15 * Math.sin(t * (0.7 + i * 0.4)));
    ctx.translate(phaseX, phaseY);
    ctx.fillStyle = pat;

    // Cover the full viewport area in WORLD coordinates
    // (Because of the world-space translate in draw(), this maps to screen with the player centered)
    ctx.fillRect(cam.x - w / 2 - size, cam.y - h / 2 - size, w + size * 2, h + size * 2);
    ctx.restore();
  }
}



export function draw(ctx, cam, w, h) {
  // Enter world space (player centered)
  ctx.save();
  ctx.translate(-cam.x + w / 2, -cam.y + h / 2);

  // Tile window around the view with PAD
  const viewCols = Math.ceil(w / TILE_SIZE);
  const viewRows = Math.ceil(h / TILE_SIZE);
  const left     = Math.floor((cam.x - w / 2) / TILE_SIZE) - PAD;
  const top      = Math.floor((cam.y - h / 2) / TILE_SIZE) - PAD;
  const right    = left + viewCols + PAD * 2;
  const bottom   = top  + viewRows + PAD * 2;

  // Pixel bounds for the fill
  const pxLeft   = left   * TILE_SIZE;
  const pxTop    = top    * TILE_SIZE;
  const pxWidth  = (right - left) * TILE_SIZE;
  const pxHeight = (bottom - top) * TILE_SIZE;

  // 1) Solid fog body
  ctx.fillStyle = FOG_COLOR;
  ctx.fillRect(pxLeft, pxTop, pxWidth, pxHeight);

  // 1b) Optional shimmer layer (centered on viewport)
  if (typeof drawShimmer === "function") {
    drawShimmer(ctx, cam, w, h);
  }

  // 2) Punch visible holes — merge contiguous runs per row (RLE)
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();

  const offX = Math.floor(S.fxTiles);
  const offY = Math.floor(S.fyTiles);
  const rows = new Map(); // ty -> number[] of tx

  // Collect tiles that are cleared and inside our scan window
  for (const k of clearedMap.keys()) {
    const [fx, fy] = k.split(",").map(Number);
    const tx = fx + offX;
    const ty = fy + offY;
    if (tx < left || tx >= right || ty < top || ty >= bottom) continue;
    let xs = rows.get(ty);
    if (!xs) { xs = []; rows.set(ty, xs); }
    xs.push(tx);
  }

  // Emit rects for contiguous runs within each row
  let tilesDrawn = 0;
  for (const [ty, xs] of rows) {
    xs.sort((a, b) => a - b);
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

  // 3) Edge‑rim glow pass (additive), only along fresh frontier tiles
  ctx.globalCompositeOperation = "lighter";
  ctx.lineWidth = RIM_WIDTH;
  ctx.strokeStyle = RIM_COLOR;

  // (temporary debug spice so it really pops; harmless when RIM_WIDTH small)
  const prevShadowBlur = ctx.shadowBlur;
  const prevShadowColor = ctx.shadowColor;
  if (config.flags.devhud) {
    ctx.shadowBlur = 4;
    ctx.shadowColor = RIM_COLOR;
  }

  let rimDrawn = 0;
  for (const k of frontier) {
    if (rimDrawn >= RIM_MAX_PERF) break;

    const tCleared = clearedMap.get(k);
    if (tCleared === undefined) continue;
    const age = S.time - tCleared;
    if (age > RIM_TTL_S) continue;

    const [fx, fy] = k.split(",").map(Number);
    const tx = fx + offX;
    const ty = fy + offY;
    if (tx < left || tx >= right || ty < top || ty >= bottom) continue;

    // brighter baseline + fade so it’s visible
    const alpha = 0.85 * Math.max(0, 1 - age / RIM_TTL_S) + 0.15;
    ctx.globalAlpha = alpha;

    const sx = tx * TILE_SIZE + 0.5;
    const sy = ty * TILE_SIZE + 0.5;
    const sw = TILE_SIZE - 1;
    const sh = TILE_SIZE - 1;
    ctx.strokeRect(sx, sy, sw, sh);
    rimDrawn++;
  }

  // Restore normal blending & transform
  ctx.shadowBlur = prevShadowBlur;
  ctx.shadowColor = prevShadowColor;
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.restore();
}