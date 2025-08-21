import { worldToTile } from "../../core/coords.js";
import { config } from "../../core/config.js";

// --- Config knobs ---
const TILE_SIZE      = 4;     // match miasma (4px tiles)
const CLUSTER_CHANCE = 0.0001; // fewer clusters
const CLUSTER_SIZE   = 220;    // slightly larger
const GROW_CHANCE    = 0.9;    // unused by painter but kept for compatibility
const CHUNK_SIZE     = 64;    // tiles per chunk

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
function generateCluster(seedTx, seedTy, rng) {
  // Eden-style crystal growth:
  // - start from a seed
  // - grow in rounds from the current frontier
  // - each round expands equally in all directions with a randomized acceptance
  // - leave gaps and carve a couple of paths so it never fills everything

  const rock = rockTiles; // alias
  const keyOf = (x, y) => x + "," + y;

  // helpers
  const dirs8 = [
    [ 1, 0], [-1, 0], [ 0, 1], [ 0,-1],
    [ 1, 1], [-1, 1], [ 1,-1], [-1,-1]
  ];
  const neighbors8 = (x, y) => {
    let n = 0;
    for (const [dx,dy] of dirs8) if (rock.has(keyOf(x+dx,y+dy))) n++;
    return n;
  };

  // parameters (tweak to taste)
  const targetTiles    = CLUSTER_SIZE;     // total tiles in cluster
  const acceptCardinal = 0.60;             // base accept prob for N/E/S/W
  const acceptDiagonal = 0.60;             // same for diagonals → equal growth
  const gapChance      = 0.12;             // chance to skip to create gaps
  const softenTipsProb = 0.25;             // remove 1‑neighbor tips sometimes
  const pathCarves     = 2;                // number of tiny path walkers
  const pathSteps      = 20;               // steps per walker

  // seed
  let minX = seedTx, maxX = seedTx, minY = seedTy, maxY = seedTy;
  const frontier = new Set([keyOf(seedTx, seedTy)]);
  rock.add(keyOf(seedTx, seedTy));
  let placed = 1;

  // grow in rounds (frontier → nextFrontier), ensures radial shells
  while (frontier.size && placed < targetTiles) {
    const nextFrontier = new Set();

    for (const k of frontier) {
      const [cx, cy] = k.split(",").map(Number);

      // shuffle dirs so no bias
      for (let i = dirs8.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = dirs8[i]; dirs8[i] = dirs8[j]; dirs8[j] = tmp;
      }

      for (const [dx, dy] of dirs8) {
        if (placed >= targetTiles) break;

        const nx = cx + dx, ny = cy + dy;
        const nk = keyOf(nx, ny);
        if (rock.has(nk)) continue;

        // equal acceptance in any direction, but allow gaps
        const accept = (dx === 0 || dy === 0) ? acceptCardinal : acceptDiagonal;
        if (rng() < gapChance) continue;
        if (rng() < accept) {
          rock.add(nk);
          placed++;

          if (nx < minX) minX = nx; if (nx > maxX) maxX = nx;
          if (ny < minY) minY = ny; if (ny > maxY) maxY = ny;

          // put this neighbor into the next round's frontier
          nextFrontier.add(nk);
        }
      }
    }

    // move to next shell
    if (nextFrontier.size === 0) break;
    frontier.clear();
    for (const nk of nextFrontier) frontier.add(nk);
  }

  // --- edge roughening: remove some isolated tips to avoid single‑tile strings
  for (let y = minY - 1; y <= maxY + 1; y++) {
    for (let x = minX - 1; x <= maxX + 1; x++) {
      const k = keyOf(x, y);
      if (!rock.has(k)) continue;
      if (neighbors8(x, y) <= 1 && rng() < softenTipsProb) rock.delete(k);
    }
  }

  // --- carve a couple of skinny paths through the interior so you can traverse
  // tiny random walkers that erase along their way
  for (let w = 0; w < pathCarves; w++) {
    // pick a random interior rock cell to start
    let sx = seedTx, sy = seedTy;
    // nudge to somewhere in the bbox
    sx = Math.floor(minX + rng() * (maxX - minX + 1));
    sy = Math.floor(minY + rng() * (maxY - minY + 1));
    for (let step = 0; step < pathSteps; step++) {
      const k = keyOf(sx, sy);
      if (rock.has(k)) rock.delete(k);
      // random step
      const [dx,dy] = dirs8[Math.floor(rng() * dirs8.length)];
      sx += dx; sy += dy;
    }
  }
}



function generateChunk(cx, cy) {
  const baseTx = cx * CHUNK_SIZE;
  const baseTy = cy * CHUNK_SIZE;

  for (let ty = baseTy; ty < baseTy + CHUNK_SIZE; ty++) {
    for (let tx = baseTx; tx < baseTx + CHUNK_SIZE; tx++) {
      const key = tx + "," + ty;
      if (rockTiles.has(key)) continue;

      // --- IMPORTANT: include config.seed for randomness ---
      const seed = ((tx * 73856093) ^ (ty * 19349663) ^ config.seed);
      const rng = mulberry32(seed);

      if (rng() < CLUSTER_CHANCE) {
        generateCluster(tx, ty, rng);
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
      generateChunk(cx, cy);
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
