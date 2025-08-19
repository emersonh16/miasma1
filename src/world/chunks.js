import { worldToTile, tileToChunk } from "../core/coords.js";
import { emit } from "../core/events.js";
import { TILE_SIZE, CHUNK_SIZE } from "./store.js";

let current = null;

export function streamAround(wx, wy) {
  const [tx, ty] = worldToTile(wx, wy, TILE_SIZE);
  const [cx, cy] = tileToChunk(tx, ty, CHUNK_SIZE);

  if (!current || current.cx !== cx || current.cy !== cy) {
    if (current) emit("onExitChunk", { cx: current.cx, cy: current.cy });
    current = { cx, cy };
    emit("onEnterChunk", current);
  }

  return current;
}
