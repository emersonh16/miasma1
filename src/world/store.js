import { worldToTile, tileToChunk, chunkToWorld, mod } from "../core/coords.js";

export const TILE_SIZE = 64; // world units per tile
export const CHUNK_SIZE = 16; // tiles per chunk

const chunks = new Map(); // key `${cx},${cy}` → { tiles:[], entities:[] }

function key(cx, cy) {
  return `${cx},${cy}`;
}

export function setChunk(cx, cy, data) {
  chunks.set(key(cx, cy), { cx, cy, ...data });
}

export function getChunk(cx, cy) {
  return chunks.get(key(cx, cy));
}

export function deleteChunk(cx, cy) {
  chunks.delete(key(cx, cy));
}

export function hasChunk(cx, cy) {
  return chunks.has(key(cx, cy));
}

export function getTile(wx, wy) {
  const [tx, ty] = worldToTile(wx, wy, TILE_SIZE);
  const [cx, cy] = tileToChunk(tx, ty, CHUNK_SIZE);
  const lx = mod(tx, CHUNK_SIZE);
  const ly = mod(ty, CHUNK_SIZE);

  const chunk = getChunk(cx, cy);
  if (!chunk) return { id: 0, solid: false };
  const tile = chunk.tiles[ly * CHUNK_SIZE + lx];
  return tile ?? { id: 0, solid: false };
}

export function iterEntitiesInAABB(ax, ay, bx, by) {
  const [tAx, tAy] = worldToTile(ax, ay, TILE_SIZE);
  const [tBx, tBy] = worldToTile(bx, by, TILE_SIZE);
  const [cAx, cAy] = tileToChunk(tAx, tAy, CHUNK_SIZE);
  const [cBx, cBy] = tileToChunk(tBx, tBy, CHUNK_SIZE);

  return (function* () {
    for (let cy = cAy; cy <= cBy; cy++) {
      for (let cx = cAx; cx <= cBx; cx++) {
        const chunk = getChunk(cx, cy);
        if (!chunk || !chunk.entities) continue;
        for (const e of chunk.entities) {
          const ex = e.x ?? e.wx;
          const ey = e.y ?? e.wy;
          if (ex >= ax && ex < bx && ey >= ay && ey < by) yield e;
        }
      }
    }
  })();
}

export function chunkBounds(cx, cy) {
  const [wx, wy] = chunkToWorld(cx, cy, CHUNK_SIZE, TILE_SIZE);
  const size = CHUNK_SIZE * TILE_SIZE;
  return [wx, wy, wx + size, wy + size];
}
