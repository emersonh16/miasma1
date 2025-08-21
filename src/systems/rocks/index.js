import { worldToTile } from "../../core/coords.js";
import { config } from "../../core/config.js";


// --- Config knobs ---
const TILE_SIZE      = 4;     // match miasma (4px tiles)
const CLUSTER_CHANCE = 0.001; // lower → fewer seeds
const CLUSTER_SIZE   = 120;   // higher → bigger clusters
const GROW_CHANCE    = 0.7;   // higher → denser blobs
const CHUNK_SIZE     = 64;    // world tiles per chunk  



// --- State: anchored rock tiles by key "tx,ty" ---
const rockTiles = new Set();

function mod(n, m) {
  return ((n % m) + m) % m;
}

// Deterministic RNG (per seed cluster)
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
  const frontier = [[seedTx, seedTy]];
  let count = 0;

  while (frontier.length && count < CLUSTER_SIZE) {
    const [tx, ty] = frontier.pop();
    const key = tx + "," + ty;
    if (rockTiles.has(key)) continue;
    rockTiles.add(key);
    count++;

    // Possible growth directions
    const dirs = [
      [1,0], [-1,0], [0,1], [0,-1],   // cardinal
      [1,1], [-1,1], [1,-1], [-1,-1]  // diagonals
    ];

    for (const [dx,dy] of dirs) {
      // Base growth chance
      let chance = GROW_CHANCE;

      // Diagonals grow less often
      if (dx !== 0 && dy !== 0) chance *= 0.6;

      // Random skips (leave gaps)
      if (rng() < 0.15) continue;

      if (rng() < chance) {
        // Normal neighbor
        frontier.push([tx+dx, ty+dy]);

        // Rarely “burst” two tiles away
        if (rng() < 0.1) {
          frontier.push([tx+dx*2, ty+dy*2]);
        }
      }
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

      // <-- include global session seed
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

// Sample: 1 if rock at world coord, else 0
export function sample(wx, wy) {
  const [tx, ty] = worldToTile(wx, wy, TILE_SIZE);
  return rockTiles.has(tx + "," + ty) ? 1 : 0;
}

// Draw rocks (world layer)
export function draw(ctx, cam, viewW, viewH) {
  const tx0 = Math.floor((cam.x - viewW/2) / TILE_SIZE);
  const ty0 = Math.floor((cam.y - viewH/2) / TILE_SIZE);
  const tx1 = Math.floor((cam.x + viewW/2) / TILE_SIZE);
  const ty1 = Math.floor((cam.y + viewH/2) / TILE_SIZE);

  ctx.fillStyle = "#555"; // rock gray
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (rockTiles.has(tx + "," + ty)) {
        const x = tx * TILE_SIZE - cam.x;
        const y = ty * TILE_SIZE - cam.y;
        ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
      }
    }
  }
}
