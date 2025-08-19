// Rolling miasma field implemented as a ring buffer anchored to
// world‑tile coordinates `(ox, oy)`. The buffer follows the world via
// integer tile scrolls and edge fills seeded deterministically.

import { worldToTile, mod } from "../../core/coords.js";
import { config } from "../../core/config.js";

const TILE_SIZE = 64; // world units per tile
const MARGIN = 4; // tile margin around the viewport

// Internal state
const S = {
  density: null, // Uint8Array
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

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(tx, ty, t) {
  let h =
    config.seed ^ (tx * 73856093) ^ (ty * 19349663) ^ (t * 83492791);
  h ^= h >>> 16;
  return h >>> 0;
}

function miasmaSeed(tx, ty, time) {
  const rand = mulberry32(hash(tx, ty, Math.floor(time)));
  return Math.floor(rand() * 256);
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
    return 255;
  const ix = mod(tx - S.ox, S.width);
  const iy = mod(ty - S.oy, S.height);
  return S.density[iy * S.width + ix];
}

export function clearArea(wx, wy, r, amt = 64) {
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
      const before = S.density[idx];
      if (before > 0) {
        const after = Math.max(0, before - amt);
        if (after !== before) {
          S.density[idx] = after;
          cleared++;
          budget--;
        }
      }
    }
  }
  return cleared;
}

export function update(dt) {
  S.time += dt;
  S.windX += S.windVX * dt;
  S.windY += S.windVY * dt;

  let sx = 0;
  if (S.windX >= 1) {
    sx = Math.floor(S.windX);
    S.windX -= sx;
  } else if (S.windX <= -1) {
    sx = Math.ceil(S.windX);
    S.windX -= sx;
  }

  let sy = 0;
  if (S.windY >= 1) {
    sy = Math.floor(S.windY);
    S.windY -= sy;
  } else if (S.windY <= -1) {
    sy = Math.ceil(S.windY);
    S.windY -= sy;
  }

  if (sx || sy) scroll(sx, sy);

  let edgeBudget = config.maxEdgeFillPerTick;
  while (edgeBudget > 0 && S.fillQueue.length) {
    const { index, tx, ty } = S.fillQueue.shift();
    S.density[index] = miasmaSeed(tx, ty, S.time);
    edgeBudget--;
  }

  let regrowBudget = config.maxTilesUpdatedPerTick;
  const total = S.width * S.height;
  while (regrowBudget > 0 && total > 0) {
    const idx = S.regrowIndex;
    const tx = S.ox + (idx % S.width);
    const ty = S.oy + Math.floor(idx / S.width);
    const target = miasmaSeed(tx, ty, S.time);
    const cur = S.density[idx];
    if (cur < target) S.density[idx] = Math.min(target, cur + 1);
    S.regrowIndex = (S.regrowIndex + 1) % total;
    regrowBudget--;
  }
}

export function draw(ctx, cam, w, h) {
  // Lightweight overlay preview anchored to world space so it scrolls
  // opposite to camera movement. Origin is at world (0,0).
  const cx = w / 2 - cam.x;
  const cy = h / 2 - cam.y;
  const grd = ctx.createRadialGradient(
    cx,
    cy,
    64,
    cx,
    cy,
    Math.hypot(w, h) / 1.2
  );
  grd.addColorStop(0, "rgba(128,0,180,0.05)");
  grd.addColorStop(1, "rgba(128,0,180,0.35)");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, w, h);
}

