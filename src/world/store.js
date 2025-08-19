// Minimal world stub to start; chunking scaffolding using shared helpers.
import { worldToTile, tileToChunk, mod } from "../core/coords.js";

const TILE_SIZE = 64; // world units per tile
const CHUNK_SIZE = 16; // tiles per chunk

export function getTile(wx, wy) {
  const [tx, ty] = worldToTile(wx, wy, TILE_SIZE);
  const [cx, cy] = tileToChunk(tx, ty, CHUNK_SIZE);
  const lx = mod(tx, CHUNK_SIZE);
  const ly = mod(ty, CHUNK_SIZE);

  // Future: look up chunk (cx, cy) and tile (lx, ly); placeholder tile for now.
  return { id: 0, solid: false };
}
