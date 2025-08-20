// Simplified miasma: viewport-aligned grid with persistent cleared tiles.
// - No ring buffer, no offscreen blitting.
// - Density is implicit: a world tile is FOG (1) unless it's in clearedTiles (0).
// - Regrow only scans viewport + pad and spreads by adjacency w/ randomness.

import { worldToTile } from "../../core/coords.js";
import { config } from "../../core/config.js";
import * as wind from "../wind/index.js";

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
  // carry fractional motion between frames (in tiles)
  accTilesX: 0,
  accTilesY: 0,
  // last view dims (in px) so we can adapt on resize
  viewW: 0,
  viewH: 0,
  time: 0,
};


// Shimmer config/state
const NOISE_SIZE = 256; // bigger = chunkier shimmer
S.noiseOffX = 0;  // px
S.noiseOffY = 0;  // px
S.vxSh = 0;       // px/sec (smoothed)
S.vySh = 0;       // px/sec (smoothed)


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

  // --- Wind‑driven shimmer motion (continuous) ---
  {
    const vel = wind.getVelocity({
      centerWX,
      centerWY,
      tileSize: TILE_SIZE,
      time: S.time,
    });
    const spd = MC.shimmerSpeed ?? 0;
    const targetVX = vel.vxTilesPerSec * TILE_SIZE * spd;
    const targetVY = vel.vyTilesPerSec * TILE_SIZE * spd;
    S.vxSh = targetVX;
    S.vySh = targetVY;
    S.noiseOffX -= S.vxSh * dt;
    S.noiseOffY -= S.vySh * dt;

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

  if (clearedMap.size > S.cols * S.rows * 4) {
    for (const k of clearedMap.keys()) {
      const [lx, ly] = k.split(",").map(Number);
      const tx = lx + S.ox;
      const ty = ly + S.oy;
      if (tx < keepLeft || tx >= keepRight || ty < keepTop || ty >= keepBottom) {
        clearedMap.delete(k);
      }
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

    const [lx, ly] = k.split(",").map(Number);
    const tx = lx + S.ox;
    const ty = ly + S.oy;
    if (tx < scanLeft || tx >= scanRight || ty < scanTop || ty >= scanBottom) continue;

    if ((S.time - tCleared) < delayS) continue;

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
  const pxLeft   = left   * TILE_SIZE;
  const pxTop    = top    * TILE_SIZE;
  const pxWidth  = (right - left) * TILE_SIZE;
  const pxHeight = (bottom - top) * TILE_SIZE;

  ctx.fillStyle = FOG_COLOR;
  ctx.fillRect(pxLeft, pxTop, pxWidth, pxHeight);

// 1.5) Wind‑driven shimmer overlay (very low cost)
// --- build noise once ---
if (!S._noise) {
  const off = document.createElement("canvas");
  off.width = off.height = NOISE_SIZE;
  const o = off.getContext("2d");

  function mulberry32(a){
    return function(){
      a|=0; a=(a+0x6D2B79F5)|0;
      let t=Math.imul(a^(a>>>15),1|a);
      t=(t+Math.imul(t^(t>>>7),61|t))^t;
      return ((t^(t>>>14))>>>0)/4294967296;
    };
  }
  const rnd = mulberry32((config.seed ?? 1337) ^ 0x51f1e);
  // base
  o.fillStyle = "#000";
  o.fillRect(0,0,NOISE_SIZE,NOISE_SIZE);
  // speckles
  o.fillStyle = "#fff";
  for (let i=0;i<NOISE_SIZE*NOISE_SIZE*0.06;i++){
    o.fillRect((rnd()*NOISE_SIZE)|0,(rnd()*NOISE_SIZE)|0,1,1);
  }
  S._noise = off;
}

const pat = ctx.createPattern(S._noise, "repeat");
const prevAlpha = ctx.globalAlpha;
const prevOp = ctx.globalCompositeOperation;

// Use continuous, world‑anchored offsets (integrated in update)
const ox = ((S.noiseOffX % NOISE_SIZE) + NOISE_SIZE) % NOISE_SIZE;
const oy = ((S.noiseOffY % NOISE_SIZE) + NOISE_SIZE) % NOISE_SIZE;

ctx.save();
ctx.translate(pxLeft, pxTop);
ctx.globalAlpha = (MC.shimmerAlpha ?? 0.35);
ctx.globalCompositeOperation = "soft-light";

// Apply phase offset directly to the pattern
pat.setTransform(new DOMMatrix().translate(ox, oy));
ctx.fillStyle = pat;

ctx.fillRect(0, 0, pxWidth, pxHeight);
ctx.restore();


ctx.globalAlpha = prevAlpha;
ctx.globalCompositeOperation = prevOp;


  // 2) Punch visible holes only, in one path (unchanged)
  ctx.globalCompositeOperation = "destination-out";

  let holes = 0;
  ctx.beginPath();
  for (const k of clearedMap.keys()) {
    const [lx, ly] = k.split(",").map(Number);
    const tx = lx + S.ox;
    const ty = ly + S.oy;
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
