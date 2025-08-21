import { CHUNK_SIZE, TILE_SIZE } from "./store.js";
import { chunkToWorld } from "../core/coords.js";
import { config } from "../core/config.js";

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
    // Pick a random tile in this chunk
    const lx = Math.floor(rand() * CHUNK_SIZE);
    const ly = Math.floor(rand() * CHUNK_SIZE);
    const idx = ly * CHUNK_SIZE + lx;

    // Mark that tile as solid rock
    tiles[idx] = { id: 1, solid: true };

    // Also drop a simple rock entity at that tile center (future visuals/collisions)
    const wx = baseWX + lx * TILE_SIZE + TILE_SIZE * 0.5;
    const wy = baseWY + ly * TILE_SIZE + TILE_SIZE * 0.5;
    entities.push({ type: "rock", wx, wy });
  }

  // --- NEW: spawn 1–3 random enemies per chunk
  const enemyCount = Math.floor(rand() * 3); // 0,1,2
  for (let i = 0; i < enemyCount; i++) {
    const ex = baseWX + rand() * CHUNK_SIZE * TILE_SIZE;
    const ey = baseWY + rand() * CHUNK_SIZE * TILE_SIZE;
    entities.push({ type: "enemy", wx: ex, wy: ey, r: 12, kind: "slime", hp: 3 });
  }

  return { tiles, entities };
}

export function evictChunk(_cx, _cy, _data) {
  // placeholder for future resource cleanup
}
