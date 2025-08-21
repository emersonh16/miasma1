import { worldToTile } from "../../core/coords.js";
import { config } from "../../core/config.js";

// --- Config knobs ---
// --- Config knobs ---
const TILE_SIZE       = 4;       // match miasma (4px tiles)
const CHUNK_SIZE      = 64;      // tiles per chunk

// random-walk “crystal” growth (per-chunk)
const SEEDS_PER_CHUNK = 2;       // walkers to start per chunk
const STEPS_PER_SEED  = 140;     // steps per walker
const BRANCH_PROB     = 0.06;    // chance to spawn a short branch
const BRANCH_STEPS    = 60;      // steps for branch walker
const SPAWN_SAFE_TILES= 10;      // keep clear around player spawn

// cleanup / shaping
const PRUNE_TIPS_PROB = 0.75;    // remove degree<=1 tiles with this prob
const CARVE_DENSE     = true;    // carve paths if too dense
const CARVE_WALKERS   = 2;       // num of carve walkers
const CARVE_STEPS     = 18;      // steps per carve walker


// --- State: anchored rock tiles by key "tx,ty" ---
const rockTiles = new Set();

// Deterministic RNG (with session seed mixed in)
function mulberry32(a) {
  return function() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Helpers ---
function generateChunk(cx, cy, playerTx, playerTy) {
  // seeded per chunk so it’s deterministic for this session
  const seed = ((cx * 73856093) ^ (cy * 19349663) ^ config.seed) >>> 0;
  const rng  = mulberry32(seed);

  const baseTx = cx * CHUNK_SIZE;
  const baseTy = cy * CHUNK_SIZE;
  const endTx  = baseTx + CHUNK_SIZE - 1;
  const endTy  = baseTy + CHUNK_SIZE - 1;

  const safeR2 = SPAWN_SAFE_TILES * SPAWN_SAFE_TILES;

  // local helpers
  const keyOf = (x,y) => x + "," + y;
  const dirs4 = [[1,0],[-1,0],[0,1],[0,-1]];
  const dirs8 = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]];
  const inSafe = (tx,ty) => {
    const dx = tx - playerTx, dy = ty - playerTy;
    return (dx*dx + dy*dy) <= safeR2;
  };

  // walkers
  for (let s = 0; s < SEEDS_PER_CHUNK; s++) {
    // choose a start inside the chunk (retry away from spawn safe)
    let sx = baseTx + Math.floor(rng() * CHUNK_SIZE);
    let sy = baseTy + Math.floor(rng() * CHUNK_SIZE);
    for (let r = 0; r < 8 && inSafe(sx,sy); r++) {
      sx = baseTx + Math.floor(rng() * CHUNK_SIZE);
      sy = baseTy + Math.floor(rng() * CHUNK_SIZE);
    }

    walkAndPaint(sx, sy, STEPS_PER_SEED, true);
  }

  // prune stringers & carve paths to keep it navigable
  pruneAndCarve(baseTx, baseTy, endTx, endTy, rng);

  // ---- walker implementation ----
  function walkAndPaint(startTx, startTy, steps, allowBranch) {
    let tx = startTx, ty = startTy;

    for (let i = 0; i < steps; i++) {
      if (!inSafe(tx,ty)) rockTiles.add(keyOf(tx,ty));

      // move: cardinal step with tiny diagonal wobble to reduce straight veins
      if (rng() < 0.85) {
        const [dx,dy] = dirs4[(rng() * dirs4.length) | 0];
        tx += dx; ty += dy;
      } else {
        const [dx,dy] = dirs8[(rng() * dirs8.length) | 0];
        tx += dx; ty += dy;
      }

      // slight drift to make shapes lumpy (random bias every so often)
      if ((i % 15) === 0) {
        const [dx,dy] = dirs4[(rng() * dirs4.length) | 0];
        if (rng() < 0.5) { tx += dx; } else { ty += dy; }
      }

      // clamp to a padded box (allow a bit of spill to reduce chunk seams)
      if (tx < baseTx-2) tx = baseTx-2;
      if (tx > endTx +2) tx = endTx +2;
      if (ty < baseTy-2) ty = baseTy-2;
      if (ty > endTy +2) ty = endTy +2;

      // occasional short branch
      if (allowBranch && rng() < BRANCH_PROB) {
        const bdir = dirs4[(rng() * dirs4.length) | 0];
        const bx = tx + bdir[0], by = ty + bdir[1];
        walkAndPaint(bx, by, BRANCH_STEPS, false);
      }
    }
  }

  function pruneAndCarve(x0,y0,x1,y1,rng) {
    // prune: remove degree<=1 to kill stringers
    const neighborCount = (x,y) => {
      let n = 0;
      for (const [dx,dy] of dirs8) if (rockTiles.has(keyOf(x+dx,y+dy))) n++;
      return n;
    };

    for (let y = y0-1; y <= y1+1; y++) {
      for (let x = x0-1; x <= x1+1; x++) {
        const k = keyOf(x,y);
        if (!rockTiles.has(k)) continue;
        if (neighborCount(x,y) <= 1 && rng() < PRUNE_TIPS_PROB) rockTiles.delete(k);
      }
    }

    if (!CARVE_DENSE) return;

    // carve: random walkers erase to ensure corridors
    for (let w = 0; w < CARVE_WALKERS; w++) {
      let sx = x0 + (rng() * (x1 - x0 + 1) | 0);
      let sy = y0 + (rng() * (y1 - y0 + 1) | 0);
      for (let i = 0; i < CARVE_STEPS; i++) {
        rockTiles.delete(keyOf(sx,sy));
        const [dx,dy] = dirs8[(rng() * dirs8.length) | 0];
        sx += dx; sy += dy;
        if (sx < x0) sx = x0; if (sx > x1) sx = x1;
        if (sy < y0) sy = y0; if (sy > y1) sy = y1;
      }
    }
  }
}



// --- API ---
export function ensureRocksForView(playerX, playerY, radiusTiles=128) {
  const playerTx = Math.floor(playerX / TILE_SIZE);
  const playerTy = Math.floor(playerY / TILE_SIZE);

  const minChunkX = Math.floor((playerTx - radiusTiles) / CHUNK_SIZE);
  const minChunkY = Math.floor((playerTy - radiusTiles) / CHUNK_SIZE);
  const maxChunkX = Math.floor((playerTx + radiusTiles) / CHUNK_SIZE);
  const maxChunkY = Math.floor((playerTy + radiusTiles) / CHUNK_SIZE);

  for (let cy = minChunkY; cy <= maxChunkY; cy++) {
    for (let cx = minChunkX; cx <= maxChunkX; cx++) {
      generateChunk(cx, cy, playerTx, playerTy);
    }
  }
}


// 1 if rock at world coord, else 0
export function sample(wx, wy) {
  const [tx, ty] = worldToTile(wx, wy, TILE_SIZE);
  return rockTiles.has(tx + "," + ty) ? 1 : 0;
}

// Draw rocks (centered on camera!)
export function draw(ctx, cam, viewW, viewH) {
  const tx0 = Math.floor((cam.x - viewW/2) / TILE_SIZE);
  const ty0 = Math.floor((cam.y - viewH/2) / TILE_SIZE);
  const tx1 = Math.floor((cam.x + viewW/2) / TILE_SIZE);
  const ty1 = Math.floor((cam.y + viewH/2) / TILE_SIZE);

  ctx.fillStyle = "#555";
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (rockTiles.has(tx + "," + ty)) {
        // <-- FIXED viewport math -->
     const x = tx * TILE_SIZE - cam.x;
const y = ty * TILE_SIZE - cam.y;
ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);

      }
    }
  }
}


// --- Collision: resolve a circle (player) against rock tiles ---
export function collidePlayer(player, radiusOverride) {
  if (!player) return;
  const r = Number.isFinite(radiusOverride) ? radiusOverride : (player.r ?? 16);
  const half = TILE_SIZE * 0.5;

  const minTx = Math.floor((player.x - r) / TILE_SIZE);
  const maxTx = Math.floor((player.x + r) / TILE_SIZE);
  const minTy = Math.floor((player.y - r) / TILE_SIZE);
  const maxTy = Math.floor((player.y + r) / TILE_SIZE);

  let corrX = 0;
  let corrY = 0;

  for (let ty = minTy; ty <= maxTy; ty++) {
    for (let tx = minTx; tx <= maxTx; tx++) {
      const k = tx + "," + ty;
      if (!rockTiles.has(k)) continue;

      // Tile center in world space
      const cx = tx * TILE_SIZE + half;
      const cy = ty * TILE_SIZE + half;

      const dx = player.x - cx;
      const dy = player.y - cy;
      const dist = Math.hypot(dx, dy) || 1;
      const minDist = r + half;

      if (dist < minDist) {
        const overlap = minDist - dist;
        corrX += (dx / dist) * overlap;
        corrY += (dy / dist) * overlap;
      }
    }
  }

  // Apply *combined* correction so we don't slip around corners
  if (corrX !== 0 || corrY !== 0) {
    player.x += corrX;
    player.y += corrY;
  }
}


// small helper
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
