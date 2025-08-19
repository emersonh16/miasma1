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
  if (rand() < 0.2) {
    const [wx, wy] = chunkToWorld(cx, cy, CHUNK_SIZE, TILE_SIZE);
    entities.push({
      type: "rock",
      wx: wx + rand() * CHUNK_SIZE * TILE_SIZE,
      wy: wy + rand() * CHUNK_SIZE * TILE_SIZE,
    });
  }

  return { tiles, entities };
}

export function evictChunk(_cx, _cy, _data) {
  // placeholder for future resource cleanup
}
