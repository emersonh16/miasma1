// Rolling miasma field implemented as a ring buffer anchored to
// world‑tile coordinates `(ox, oy)`. The buffer follows the world via
// integer tile scrolls and edge fills seeded deterministically.

import { worldToTile, mod } from "../../core/coords.js";
import { config } from "../../core/config.js";

const TILE_SIZE = 64; // world units per tile
const MARGIN = 4; // tile margin around the viewport

// Internal state
const S = {
  density: null, // Uint8Array of 0/1
  width: 0,
  height: 0,
  ox: 0,
  oy: 0,
  windX: 0,
  windY: 0,
  windVX: 0.1, // tiles per second
  windVY: 0,
  time: 0,
  fillQueue: [], // items { index, tx, ty }
  regrowIndex: 0,
};

// Binary seed: 1 = fog present, 0 = clear.
// (Swap to noise threshold later if you want patterns.)
function miasmaSeed(_tx, _ty, _time) {
  return 1;
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

export function init() {
  const VW = Math.ceil(innerWidth / TILE_SIZE);
  const VH = Math.ceil(innerHeight / TILE_SIZE);
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
  if (
    tx < S.ox ||
    tx >= S.ox + S.width ||
    ty < S.oy ||
    ty >= S.oy + S.height
  )
    return 1; // treat outside as fog
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
      if (
        tx < S.ox ||
        tx >= S.ox + S.width ||
        ty < S.oy ||
        ty >= S.oy + S.height
      )
        continue;
      const ix = mod(tx - S.ox, S.width);
      const iy = mod(ty - S.oy, S.height);
      const idx = iy * S.width + ix;
      if (S.density[idx] !== 0) {
        S.density[idx] = 0; // binary clear
        cleared++;
        budget--;
      }
    }
  }
  return cleared;
}

export function update(dt, playerWX, playerWY, worldMotion = { x: 0, y: 0 }) {
  S.time += dt;

  // 1) World scrolling (if your world ever moves under the camera)
  if (worldMotion.x || worldMotion.y) {
    const mdx = Math.round(worldMotion.x / TILE_SIZE);
    const mdy = Math.round(worldMotion.y / TILE_SIZE);
    if (mdx || mdy) scroll(mdx, mdy);
  }

  // 2) Conveyor follow: keep a padded ring covering the viewport
  const leftTile  = Math.floor((playerWX - innerWidth  / 2) / TILE_SIZE);
  const topTile   = Math.floor((playerWY - innerHeight / 2) / TILE_SIZE);
  const desiredOx = leftTile - MARGIN;
  const desiredOy = topTile  - MARGIN;

  const dx = desiredOx - S.ox;
  const dy = desiredOy - S.oy;
  if (dx || dy) scroll(dx, dy);

  // Wind advection in whole tiles
  S.windX += S.windVX * dt;
  S.windY += S.windVY * dt;

  let sx = 0;
  if (S.windX >= 1) { sx = Math.floor(S.windX); S.windX -= sx; }
  else if (S.windX <= -1) { sx = Math.ceil(S.windX); S.windX -= sx; }

  let sy = 0;
  if (S.windY >= 1) { sy = Math.floor(S.windY); S.windY -= sy; }
  else if (S.windY <= -1) { sy = Math.ceil(S.windY); S.windY -= sy; }

  if (sx || sy) scroll(sx, sy);

  // Edge fill
  let edgeBudget = config.maxEdgeFillPerTick;
  while (edgeBudget > 0 && S.fillQueue.length) {
    const { index, tx, ty } = S.fillQueue.shift();
    S.density[index] = miasmaSeed(tx, ty, S.time);
    edgeBudget--;
  }

  // Binary regrow
  let regrowBudget = config.maxTilesUpdatedPerTick;
  const total = S.width * S.height;
  while (regrowBudget > 0 && total > 0) {
    const idx = S.regrowIndex;
    const tx = S.ox + (idx % S.width);
    const ty = S.oy + Math.floor(idx / S.width);
    const target = miasmaSeed(tx, ty, S.time); // 0 or 1
    if (S.density[idx] !== target) S.density[idx] = target;
    S.regrowIndex = (S.regrowIndex + 1) % total;
    regrowBudget--;
  }
}

export function draw(ctx, cam, w, h) {
  // World-space aligned fog, uses same transform as grid/player
  ctx.save();
  ctx.translate(-cam.x + w / 2, -cam.y + h / 2);

  let budget = config.maxDrawTilesPerFrame;
  if (budget > 0) {
    const left = Math.floor((cam.x - w / 2) / TILE_SIZE);
    const right = Math.floor((cam.x + w / 2) / TILE_SIZE);
    const top = Math.floor((cam.y - h / 2) / TILE_SIZE);
    const bottom = Math.floor((cam.y + h / 2) / TILE_SIZE);

    for (let ty = top; ty <= bottom && budget > 0; ty++) {
      for (let tx = left; tx <= right && budget > 0; tx++) {
        if (tx < S.ox || tx >= S.ox + S.width || ty < S.oy || ty >= S.oy + S.height) continue;
        const ix = mod(tx - S.ox, S.width);
        const iy = mod(ty - S.oy, S.height);
        if (S.density[iy * S.width + ix] !== 1) continue; // binary
        ctx.fillStyle = "rgba(128,0,180,0.35)";
        ctx.fillRect(tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        budget--;
      }
    }
  }

  ctx.restore();
}
