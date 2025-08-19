// Rolling miasma field implemented as a ring buffer anchored to
// world-tile coordinates `(ox, oy)`. The buffer follows the world via
// integer tile scrolls and edge fills seeded deterministically.

import { worldToTile, mod } from "../../core/coords.js";
import { config } from "../../core/config.js";
import * as wind from "../wind/index.js";

const MC = (config.miasma ?? {});
const TILE_SIZE = MC.tileSize ?? 64;
const MARGIN = MC.marginTiles ?? 4;

// Internal state (binary: 0 = clear, 1 = fog)
const S = {
  density: null,   // Uint8Array of 0/1
  width: 0,
  height: 0,
  ox: 0,
  oy: 0,
  windX: 0,
  windY: 0,
  time: 0,
  fillQueue: [],   // { index, tx, ty }
  regrowIndex: 0,
};

// Permanently-cleared world tiles
const clearedTiles = new Set();
const tkey = (tx, ty) => `${tx},${ty}`;

// Binary seed: full fog unless permanently cleared
function miasmaSeed(tx, ty, _time) {
  return clearedTiles.has(tkey(tx, ty)) ? 0 : 1;
}

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

export function init(viewW, viewH) {
  const VW = Math.ceil(viewW / TILE_SIZE);
  const VH = Math.ceil(viewH / TILE_SIZE);
  S.width = VW + MARGIN * 2;
  S.height = VH + MARGIN * 2;
  S.ox = 0;
  S.oy = 0;

  S.density = new Uint8Array(S.width * S.height);
  for (let y = 0; y < S.height; y++) {
    for (let x = 0; x < S.width; x++) {
      const tx = S.ox + x;
      const ty = S.oy + y;
      S.density[y * S.width + x] = miasmaSeed(tx, ty, 0);
    }
  }

  S.fillQueue.length = 0;
  S.regrowIndex = 0;
  S.windX = 0;
  S.windY = 0;
  S.time = 0;
}

export function sample(wx, wy) {
  const [tx, ty] = worldToTile(wx, wy, TILE_SIZE);
  if (tx < S.ox || tx >= S.ox + S.width || ty < S.oy || ty >= S.oy + S.height) {
    return 1; // outside current ring = treat as fog
  }
  const ix = mod(tx - S.ox, S.width);
  const iy = mod(ty - S.oy, S.height);
  return S.density[iy * S.width + ix];
}

export function clearArea(wx, wy, r, _amt = 64) {
  const [cx, cy] = worldToTile(wx, wy, TILE_SIZE);
  const tr = Math.ceil(r / TILE_SIZE);
  let cleared = 0;
  let budget = config.maxTilesUpdatedPerTick;

  for (let dy = -tr; dy <= tr && budget > 0; dy++) {
    for (let dx = -tr; dx <= tr && budget > 0; dx++) {
      if (dx * dx + dy * dy > tr * tr) continue;

      const tx = cx + dx;
      const ty = cy + dy;
      if (tx < S.ox || tx >= S.ox + S.width || ty < S.oy || ty >= S.oy + S.height) continue;

      const ix = mod(tx - S.ox, S.width);
      const iy = mod(ty - S.oy, S.height);
      const idx = iy * S.width + ix;

      if (S.density[idx] !== 0) {
        S.density[idx] = 0;              // clear in-ring
        clearedTiles.add(tkey(tx, ty));  // remember forever
        cleared++;
        budget--;
      }
    }
  }
  return cleared;
}

export function update(dt, centerWX, centerWY, worldMotion = { x: 0, y: 0 }, viewW = innerWidth, viewH = innerHeight) {
  S.time += dt;

  // 1) Apply world motion in whole tiles
  if (worldMotion.x || worldMotion.y) {
    const mdx = Math.trunc(worldMotion.x / TILE_SIZE);
    const mdy = Math.trunc(worldMotion.y / TILE_SIZE);
    if (mdx || mdy) scroll(mdx, mdy);
  }

  // 2) Wind advection FIRST
  const wv = wind.getVelocity({ centerWX, centerWY, time: S.time, tileSize: TILE_SIZE });
  S.windX += (wv.vxTilesPerSec || 0) * dt;
  S.windY += (wv.vyTilesPerSec || 0) * dt;

  let sx = 0, sy = 0;
  if (S.windX >= 1) { sx = Math.floor(S.windX); S.windX -= sx; }
  else if (S.windX <= -1) { sx = Math.ceil(S.windX); S.windX -= sx; }
  if (S.windY >= 1) { sy = Math.floor(S.windY); S.windY -= sy; }
  else if (S.windY <= -1) { sy = Math.ceil(S.windY); S.windY -= sy; }
  if (sx || sy) scroll(sx, sy);

  // 3) Margin clamp (top up edges only)
  const VW = Math.ceil(viewW / TILE_SIZE);
  const VH = Math.ceil(viewH / TILE_SIZE);
  const camLeft   = Math.floor((centerWX - viewW / 2) / TILE_SIZE);
  const camRight  = camLeft + VW - 1;
  const camTop    = Math.floor((centerWY - viewH / 2) / TILE_SIZE);
  const camBottom = camTop + VH - 1;

  if (camLeft - S.ox < MARGIN) {
    const need = MARGIN - (camLeft - S.ox);
    if (need > 0) scroll(-need, 0);
  }
  if ((S.ox + S.width - 1) - camRight < MARGIN) {
    const need = MARGIN - ((S.ox + S.width - 1) - camRight);
    if (need > 0) scroll(need, 0);
  }
  if (camTop - S.oy < MARGIN) {
    const need = MARGIN - (camTop - S.oy);
    if (need > 0) scroll(0, -need);
  }
  if ((S.oy + S.height - 1) - camBottom < MARGIN) {
    const need = MARGIN - ((S.oy + S.height - 1) - camBottom);
    if (need > 0) scroll(0, need);
  }

  // 4) Edge fill
  let edgeBudget = (MC.maxEdgeFillPerTick ?? config.maxEdgeFillPerTick ?? 128);
  while (edgeBudget > 0 && S.fillQueue.length) {
    const { index, tx, ty } = S.fillQueue.shift();
    S.density[index] = miasmaSeed(tx, ty, S.time);
    edgeBudget--;
  }

  // 5) Binary regrow
  let regrowBudget = (MC.maxTilesUpdatedPerTick ?? config.maxTilesUpdatedPerTick ?? 256);
  const total = S.width * S.height;
  while (regrowBudget > 0 && total > 0) {
    const idx = S.regrowIndex;
    const tx = S.ox + (idx % S.width);
    const ty = S.oy + Math.floor(idx / S.width);
    const target = miasmaSeed(tx, ty, S.time);
    if (S.density[idx] !== target) S.density[idx] = target;
    S.regrowIndex = (S.regrowIndex + 1) % total;
    regrowBudget--;
  }
}

export function draw(ctx, cam, w, h) {
  ctx.save();

  // include fractional wind remainder (sub-pixel smoothness)
  const fracOffX = (S.windX || 0) * TILE_SIZE;
  const fracOffY = (S.windY || 0) * TILE_SIZE;
  ctx.translate(-cam.x + w / 2 - fracOffX, -cam.y + h / 2 - fracOffY);

  let budget = (MC.maxDrawTilesPerFrame ?? config.maxDrawTilesPerFrame ?? 4096);
  if (budget > 0) {
    const left   = Math.floor((cam.x - w / 2) / TILE_SIZE);
    const right  = Math.floor((cam.x + w / 2) / TILE_SIZE);
    const top    = Math.floor((cam.y - h / 2) / TILE_SIZE);
    const bottom = Math.floor((cam.y + h / 2) / TILE_SIZE);

    ctx.fillStyle = (MC.color ?? "rgba(128,0,180,0.35)");

    for (let ty = top; ty <= bottom && budget > 0; ty++) {
      let runStart = null;

      for (let tx = left; tx <= right; tx++) {
        if (tx < S.ox || tx >= S.ox + S.width || ty < S.oy || ty >= S.oy + S.height) {
          if (runStart !== null) {
            const wTiles = tx - runStart;
            ctx.fillRect(runStart * TILE_SIZE, ty * TILE_SIZE, wTiles * TILE_SIZE, TILE_SIZE);
            runStart = null;
            if (--budget <= 0) break;
          }
          continue;
        }

        const ix = mod(tx - S.ox, S.width);
        const iy = mod(ty - S.oy, S.height);
        const filled = (S.density[iy * S.width + ix] === 1);

        if (filled) {
          if (runStart === null) runStart = tx;
        } else if (runStart !== null) {
          const wTiles = tx - runStart;
          ctx.fillRect(runStart * TILE_SIZE, ty * TILE_SIZE, wTiles * TILE_SIZE, TILE_SIZE);
          runStart = null;
          if (--budget <= 0) break;
        }
      }

      if (budget > 0 && runStart !== null) {
        const wTiles = (right + 1) - runStart;
        ctx.fillRect(runStart * TILE_SIZE, ty * TILE_SIZE, wTiles * TILE_SIZE, TILE_SIZE);
        runStart = null;
        budget--;
      }
    }
  }

  ctx.restore();
}

export function getTileSize() { return TILE_SIZE; }
