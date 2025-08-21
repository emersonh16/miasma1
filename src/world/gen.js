import { CHUNK_SIZE, TILE_SIZE } from "./store.js";
import { chunkToWorld } from "../core/coords.js";
import { config } from "../core/config.js";
import { makeEnemy } from "../entities/enemy.js";
<<<<<<< HEAD
=======

>>>>>>> 883ff51 (i got baaddies)

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(cx, cy) {
  let h = config.seed ^ (cx * 73856093) ^ (cy * 19349663);
  return h >>> 0;
}

export function generateChunk(cx, cy) {
  const rand = mulberry32(hash(cx, cy));
  const tiles = new Array(CHUNK_SIZE * CHUNK_SIZE);
  for (let i = 0; i < tiles.length; i++) tiles[i] = { id: 0, solid: false };

  const entities = [];

  // Decide how many rock tiles to place in this chunk (0–3)
  const rocksInChunk = (rand() < 0.6) ? Math.floor(rand() * 4) : 0;

  // Chunk world origin
  const [baseWX, baseWY] = chunkToWorld(cx, cy, CHUNK_SIZE, TILE_SIZE);

  for (let i = 0; i < rocksInChunk; i++) {
    const lx = Math.floor(rand() * CHUNK_SIZE);
    const ly = Math.floor(rand() * CHUNK_SIZE);
    const idx = ly * CHUNK_SIZE + lx;
    tiles[idx] = { id: 1, solid: true };

    const wx = baseWX + lx * TILE_SIZE + TILE_SIZE * 0.5;
    const wy = baseWY + ly * TILE_SIZE + TILE_SIZE * 0.5;
    entities.push({ type: "rock", wx, wy });
  }

<<<<<<< HEAD
  // Drop one or more enemies on non-solid tiles
  const enemiesInChunk = 1 + Math.floor(rand() * 3);
  for (let i = 0; i < enemiesInChunk; i++) {
    let attempts = 0;
    while (attempts++ < 10) {
      const lx = Math.floor(rand() * CHUNK_SIZE);
      const ly = Math.floor(rand() * CHUNK_SIZE);
      const idx = ly * CHUNK_SIZE + lx;
      if (tiles[idx].solid) continue;
      const x = baseWX + lx * TILE_SIZE + TILE_SIZE * 0.5;
      const y = baseWY + ly * TILE_SIZE + TILE_SIZE * 0.5;
      entities.push(makeEnemy(x, y));
      break;
    }
  }

=======
  // 🎃 spawn 1–3 random enemies per chunk
  const enemyCount = Math.floor(rand() * 3);
  for (let i = 0; i < enemyCount; i++) {
    const ex = baseWX + rand() * CHUNK_SIZE * TILE_SIZE;
    const ey = baseWY + rand() * CHUNK_SIZE * TILE_SIZE;
    entities.push({ type: "enemy", wx: ex, wy: ey, r: 12, kind: "slime" });
  }


  // --- Placeholder enemy spawn (10% chance per chunk) ---
if (rand() < 0.1) {
  const lx = Math.floor(rand() * CHUNK_SIZE);
  const ly = Math.floor(rand() * CHUNK_SIZE);
  const wx = baseWX + lx * TILE_SIZE + TILE_SIZE * 0.5;
  const wy = baseWY + ly * TILE_SIZE + TILE_SIZE * 0.5;
  entities.push(makeEnemy(wx, wy));
}


>>>>>>> 883ff51 (i got baaddies)
  return { tiles, entities };
}

export function evictChunk(_cx, _cy, _data) {
  // placeholder for future resource cleanup
}
