// Rolling miasma field implemented as a ring buffer anchored to
// world-tile coordinates `(ox, oy)`, rendered via an offscreen canvas
// (blit) so each frame is a single drawImage instead of thousands of rects.

import { worldToTile, mod } from "../../core/coords.js";
import { config } from "../../core/config.js";
import * as wind from "../wind/index.js";

const MC = (config.miasma ?? {});
const TILE_SIZE = MC.tileSize ?? 64;
const MARGIN = MC.marginTiles ?? 4;
const WIND_STEP_TILES = MC.windStepTiles ?? 4;   // jump every N tiles of wind
const CLAMP_HYST      = MC.clampHysteresis ?? 1; // clamp only if margin < (MARGIN-HYST)
const FOG_COLOR = (MC.color ?? "rgba(128,0,180,0.35)");

// Internal state (density: 0 = clear, 1 = full fog)
const S = {
  density: null,   // Float32Array of 0..1
  width: 0,
  height: 0,
  ox: 0,
  oy: 0,

  // Wind fractional phase (tiles)
  windX: 0,
  windY: 0,

  // Camera fractional shift (tiles) — accumulates worldMotion / TILE_SIZE
  camShiftX: 0,
  camShiftY: 0,

  time: 0,
  fillQueue: [],   // { index, tx, ty }
  regrowIndex: 0,

  // Offscreen blit surface for the ring buffer
  fogCanvas: null,
  fogCtx: null,
};

// Temp canvas for wrap copies
function ensureTmp() {
  if (!S.tmpCanvas) {
    S.tmpCanvas = document.createElement("canvas");
    S.tmpCanvas.width = S.fogCanvas.width;
    S.tmpCanvas.height = S.fogCanvas.height;
    S.tmpCtx = S.tmpCanvas.getContext("2d");
  }
}

// Shift the offscreen fog image by whole tiles (dx,dy), wrapping around
function shiftFogPixels(dxTiles, dyTiles) {
  if (!S.fogCanvas) return;
  if (!dxTiles && !dyTiles) return;

  ensureTmp();
  const W = S.fogCanvas.width;
  const H = S.fogCanvas.height;

  // pixel shift for the offscreen image
  const px = (-dxTiles * TILE_SIZE) % W;
  const py = (-dyTiles * TILE_SIZE) % H;

  // Normalize into [0..W/H)
  const norm = (v, m) => ((v % m) + m) % m;
  const sx = norm(px, W);
  const sy = norm(py, H);

  const sw1 = W - sx;
  const sh1 = H - sy;

  S.tmpCtx.clearRect(0, 0, W, H);

  // top-left piece
  S.tmpCtx.drawImage(S.fogCanvas, sx, sy, sw1, sh1, 0, 0, sw1, sh1);
  // top-right wrap
  if (sx > 0) {
    S.tmpCtx.drawImage(S.fogCanvas, 0, sy, sx, sh1, sw1, 0, sx, sh1);
  }
  // bottom-left wrap
  if (sy > 0) {
    S.tmpCtx.drawImage(S.fogCanvas, sx, 0, sw1, sy, 0, sh1, sw1, sy);
  }
  // bottom-right wrap
  if (sx > 0 && sy > 0) {
    S.tmpCtx.drawImage(S.fogCanvas, 0, 0, sx, sy, sw1, sh1, sx, sy);
  }

  // Swap back
  S.fogCtx.clearRect(0, 0, W, H);
  S.fogCtx.drawImage(S.tmpCanvas, 0, 0);

  // Enqueue new edges instead of painting them blindly
  if (dxTiles > 0) {
    for (let i = 0; i < dxTiles; i++) {
      enqueueColumn(S.ox + S.width - 1 + i);
    }
  } else if (dxTiles < 0) {
    for (let i = 0; i < -dxTiles; i++) {
      enqueueColumn(S.ox - i);
    }
  }
  if (dyTiles > 0) {
    for (let i = 0; i < dyTiles; i++) {
      enqueueRow(S.oy + S.height - 1 + i);
    }
  } else if (dyTiles < 0) {
    for (let i = 0; i < -dyTiles; i++) {
      enqueueRow(S.oy - i);
    }
  }
}



// Seed: always fog so cleared tiles can regrow
function miasmaSeed(_tx, _ty) {
  return 1;
}

// ---- Ring helpers ----
function enqueueColumn(tx) {
  const ix = mod(tx - S.ox, S.width);
  for (let y = 0; y < S.height; y++) {
    const ty = S.oy + y;
    const index = y * S.width + ix;
    S.fillQueue.push({ index, tx, ty });
  }
}
function enqueueRow(ty) {
  const iy = mod(ty - S.oy, S.height);
  for (let x = 0; x < S.width; x++) {
    const tx = S.ox + x;
    const index = iy * S.width + x;
    S.fillQueue.push({ index, tx, ty });
  }
}


function scroll(dx, dy) {
  // Shift offscreen pixels by full tile amounts (can be >1)
  if (dx) shiftFogPixels(dx, 0);
  if (dy) shiftFogPixels(0, dy);

  // Update ring origin and enqueue all newly exposed edges
  if (dx > 0) {
    for (let i = 0; i < dx; i++) {
      S.ox++;
      enqueueColumn(S.ox + S.width - 1);
    }
  } else if (dx < 0) {
    for (let i = 0; i < -dx; i++) {
      S.ox--;
      enqueueColumn(S.ox);
    }
  }

  if (dy > 0) {
    for (let i = 0; i < dy; i++) {
      S.oy++;
      enqueueRow(S.oy + S.height - 1);
    }
  } else if (dy < 0) {
    for (let i = 0; i < -dy; i++) {
      S.oy--;
      enqueueRow(S.oy);
    }
  }
}



// ---- Offscreen paint helpers ----
function ringIxIy(tx, ty) {
  return [mod(tx - S.ox, S.width), mod(ty - S.oy, S.height)];
}
function paintTileAtIxIy(ix, iy, density) {
  const x = ix * TILE_SIZE;
  const y = iy * TILE_SIZE;
  // always reset the pixel first to avoid alpha stacking
  S.fogCtx.clearRect(x, y, TILE_SIZE, TILE_SIZE);
  if (density > 0) {
    S.fogCtx.globalAlpha = density;
    S.fogCtx.fillStyle = FOG_COLOR;
    S.fogCtx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
    S.fogCtx.globalAlpha = 1;
  }
}

function paintTileWorld(tx, ty, density) {
  const [ix, iy] = ringIxIy(tx, ty);
  paintTileAtIxIy(ix, iy, density);
}


export function init(viewW, viewH, centerWX = 0, centerWY = 0) {
  const VW = Math.ceil(viewW / TILE_SIZE);
  const VH = Math.ceil(viewH / TILE_SIZE);
  S.width = VW + MARGIN * 2;
  S.height = VH + MARGIN * 2;
// center the ring on the given world position
const halfW = Math.floor((VW + MARGIN * 2) / 2);
const halfH = Math.floor((VH + MARGIN * 2) / 2);
S.ox = Math.floor(centerWX / TILE_SIZE) - halfW;
S.oy = Math.floor(centerWY / TILE_SIZE) - halfH;


  // Init density
  S.density = new Float32Array(S.width * S.height);
  S.density.fill(miasmaSeed(0, 0));

  // Offscreen canvas sized to ring (in pixels)
  S.fogCanvas = document.createElement("canvas");
  S.fogCanvas.width = S.width * TILE_SIZE;
  S.fogCanvas.height = S.height * TILE_SIZE;
  S.fogCtx = S.fogCanvas.getContext("2d", { alpha: true });

    // reset temp wrap surface to match new size
  S.tmpCanvas = null;
  S.tmpCtx = null;


  // Paint initial ring once
  S.fogCtx.clearRect(0, 0, S.fogCanvas.width, S.fogCanvas.height);
  S.fogCtx.globalAlpha = 1;
  S.fogCtx.fillStyle = FOG_COLOR;
  S.fogCtx.fillRect(0, 0, S.fogCanvas.width, S.fogCanvas.height);
  S.fogCtx.globalAlpha = 1;

  // Reset runtime state
  S.fillQueue.length = 0;
  S.regrowIndex = 0;
  S.windX = 0;
  S.windY = 0;
  S.camShiftX = 0;
  S.camShiftY = 0;
  S.time = 0;
}

export function sample(wx, wy) {
  const [tx, ty] = worldToTile(wx, wy, TILE_SIZE);
  if (tx < S.ox || tx >= S.ox + S.width || ty < S.oy || ty >= S.oy + S.height) return 1;
  const ix = mod(tx - S.ox, S.width);
  const iy = mod(ty - S.oy, S.height);
  return S.density[iy * S.width + ix];
}

export function clearArea(wx, wy, r, _amt = 64) {
  const [cx, cy] = worldToTile(wx, wy, TILE_SIZE);
  const tr = Math.ceil(r / TILE_SIZE);
  let cleared = 0;
  let budget = Math.min(_amt, MC.maxTilesUpdatedPerTick ?? config.maxTilesUpdatedPerTick ?? 256);

  for (let dy = -tr; dy <= tr && budget > 0; dy++) {
    for (let dx = -tr; dx <= tr && budget > 0; dx++) {
      if (dx * dx + dy * dy > tr * tr) continue;
      const tx = cx + dx, ty = cy + dy;
      if (tx < S.ox || tx >= S.ox + S.width || ty < S.oy || ty >= S.oy + S.height) continue;

      const ix = mod(tx - S.ox, S.width);
      const iy = mod(ty - S.oy, S.height);
      const idx = iy * S.width + ix;
      if (S.density[idx] !== 0) {
        S.density[idx] = 0;                // clear in ring
        paintTileAtIxIy(ix, iy, 0);        // update offscreen
        cleared++;
        budget--;
      }
    }
  }
  return cleared;
}

export function update(dt, centerWX, centerWY, worldMotion = { x: 0, y: 0 }, viewW = innerWidth, viewH = innerHeight) {
  S.time += dt;

  // 1) Smooth camera motion via fractional accumulators (scroll on whole tiles)
  if (worldMotion.x || worldMotion.y) {
S.camShiftX += (worldMotion.x || 0) / TILE_SIZE; // cam right -> ring right (screen shows world moving left)
S.camShiftY += (worldMotion.y || 0) / TILE_SIZE; // cam down  -> ring down


    let cmx = 0, cmy = 0;
    if (S.camShiftX >= 1) { cmx = Math.floor(S.camShiftX); S.camShiftX -= cmx; }
    else if (S.camShiftX <= -1) { cmx = Math.ceil(S.camShiftX); S.camShiftX -= cmx; }
    if (S.camShiftY >= 1) { cmy = Math.floor(S.camShiftY); S.camShiftY -= cmy; }
    else if (S.camShiftY <= -1) { cmy = Math.ceil(S.camShiftY); S.camShiftY -= cmy; }
    if (cmx || cmy) scroll(cmx, cmy);
  }

// 2) Wind advection — smooth fractional with whole-tile scrolls
const wv = wind.getVelocity({ centerWX, centerWY, time: S.time, tileSize: TILE_SIZE });
// wind pushes fog in world space (opposite screen coords)
S.windX -= (wv.vxTilesPerSec || 0) * dt;
S.windY -= (wv.vyTilesPerSec || 0) * dt;


let sx = 0, sy = 0;
if (S.windX >= 1)      { sx = Math.floor(S.windX);  S.windX -= sx; }
else if (S.windX <= -1){ sx = Math.ceil(S.windX);   S.windX -= sx; }

if (S.windY >= 1)      { sy = Math.floor(S.windY);  S.windY -= sy; }
else if (S.windY <= -1){ sy = Math.ceil(S.windY);   S.windY -= sy; }

if (sx || sy) scroll(sx, sy);


  // 3) Margin clamp with hysteresis — only top up starving edges, never recenter
  const VW = Math.ceil(viewW / TILE_SIZE);
  const VH = Math.ceil(viewH / TILE_SIZE);
  const camLeft   = Math.floor((centerWX - viewW / 2) / TILE_SIZE);
  const camRight  = camLeft + VW - 1;
  const camTop    = Math.floor((centerWY - viewH / 2) / TILE_SIZE);
  const camBottom = camTop + VH - 1;

  if (camLeft - S.ox < (MARGIN - CLAMP_HYST)) {
    const need = (MARGIN - CLAMP_HYST) - (camLeft - S.ox);
    if (need > 0) scroll(-need, 0);
  }
  if ((S.ox + S.width - 1) - camRight < (MARGIN - CLAMP_HYST)) {
    const need = (MARGIN - CLAMP_HYST) - ((S.ox + S.width - 1) - camRight);
    if (need > 0) scroll(need, 0);
  }
  if (camTop - S.oy < (MARGIN - CLAMP_HYST)) {
    const need = (MARGIN - CLAMP_HYST) - (camTop - S.oy);
    if (need > 0) scroll(0, -need);
  }
  if ((S.oy + S.height - 1) - camBottom < (MARGIN - CLAMP_HYST)) {
    const need = (MARGIN - CLAMP_HYST) - ((S.oy + S.height - 1) - camBottom);
    if (need > 0) scroll(0, need);
  }

  // 4) Edge fill → update both density and offscreen (idempotent)
  let edgeBudget = (MC.maxEdgeFillPerTick ?? config.maxEdgeFillPerTick ?? 128);
  while (edgeBudget > 0 && S.fillQueue.length) {
    const { index, tx, ty } = S.fillQueue.shift();
    const v = miasmaSeed(tx, ty);
    if (S.density[index] !== v) {
      S.density[index] = v;
      paintTileWorld(tx, ty, v);
    }
    edgeBudget--;
  }


   // 5) Adjacency-based regrow with randomness, restricted to viewport+pad
  const chance = MC.regrowChance ?? 0.2;
  let regrowBudget = MC.regrowBudget ?? Math.floor((MC.maxTilesUpdatedPerTick ?? config.maxTilesUpdatedPerTick ?? 256) / 2);
  const w = S.width, h = S.height;

  const viewTilesW = Math.ceil(viewW / TILE_SIZE);
  const viewTilesH = Math.ceil(viewH / TILE_SIZE);
  const pad = MC.regrowPad ?? MARGIN;

  const viewLeft   = Math.floor((centerWX - viewW / 2) / TILE_SIZE) - pad;
  const viewTop    = Math.floor((centerWY - viewH / 2) / TILE_SIZE) - pad;
  const viewRight  = viewLeft + viewTilesW + pad * 2;
  const viewBottom = viewTop  + viewTilesH + pad * 2;

  const toGrow = [];

  for (let ty = viewTop; ty < viewBottom && regrowBudget > 0; ty++) {
    for (let tx = viewLeft; tx < viewRight && regrowBudget > 0; tx++) {
      const ix = mod(tx - S.ox, w);
      const iy = mod(ty - S.oy, h);
         const idx = iy * w + ix;
      if (S.density[idx] !== 0) continue;

      // Wrapped 4-neighbor checks on the ring
      const left  = S.density[iy * w + mod(ix - 1, w)] === 1;
      const right = S.density[iy * w + mod(ix + 1, w)] === 1;
      const up    = S.density[mod(iy - 1, h) * w + ix] === 1;
      const down  = S.density[mod(iy + 1, h) * w + ix] === 1;

      if (left || right || up || down) {
        if (Math.random() < chance) {
          toGrow.push(idx);
          regrowBudget--;
        }
      }

    }
  }

  for (const idx of toGrow) {
    S.density[idx] = 1;
    const tx = S.ox + (idx % w);
    const ty = S.oy + Math.floor(idx / w);
    paintTileWorld(tx, ty, 1);
  }


}


export function draw(ctx, cam, w, h) {
  if (!S.fogCanvas) return;

  ctx.save();

    // Wind advection is applied via scroll() in update(); draw should not add extra offsets.
  ctx.translate(-cam.x + w / 2, -cam.y + h / 2);
const windOffX = (S.windX || 0) * TILE_SIZE;
  const windOffY = (S.windY || 0) * TILE_SIZE;

  ctx.translate(
    -cam.x + w / 2 - windOffX,
    -cam.y + h / 2 - windOffY
  );

  // draw the ring canvas at its world origin (already centered by init)
  const px = S.ox * TILE_SIZE;
  const py = S.oy * TILE_SIZE;
  ctx.drawImage(S.fogCanvas, px, py);

  ctx.restore();
}




export function getTileSize() { return TILE_SIZE; }

export function getOrigin() {
  return { ox: S.ox, oy: S.oy };
}
