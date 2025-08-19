import { worldToTile, tileToChunk } from "../core/coords.js";
import { emit } from "../core/events.js";
import { config } from "../core/config.js";
import {
  TILE_SIZE,
  CHUNK_SIZE,
  setChunk,
  deleteChunk,
  getChunk,
} from "./store.js";
import { generateChunk, evictChunk } from "./gen.js";

const RADIUS = 2; // chunks in each direction from center

const loaded = new Set();
const pending = [];
let current = null;

function key(cx, cy) {
  return `${cx},${cy}`;
}

export function streamAround(wx, wy) {
  const [tx, ty] = worldToTile(wx, wy, TILE_SIZE);
  const [ccx, ccy] = tileToChunk(tx, ty, CHUNK_SIZE);

  const needed = new Set();
  for (let dy = -RADIUS; dy <= RADIUS; dy++) {
    for (let dx = -RADIUS; dx <= RADIUS; dx++) {
      const k = key(ccx + dx, ccy + dy);
      needed.add(k);
      if (!loaded.has(k) && !pending.includes(k)) pending.push(k);
    }
  }

  for (const k of Array.from(loaded)) {
    if (!needed.has(k)) {
      const [cx, cy] = k.split(",").map(Number);
      const data = getChunk(cx, cy);
      if (evictChunk) evictChunk(cx, cy, data);
      deleteChunk(cx, cy);
      loaded.delete(k);
    }
  }

  let budget = config.maxChunkGenPerFrame;
  while (budget > 0 && pending.length) {
    const k = pending.shift();
    const [cx, cy] = k.split(",").map(Number);
    if (loaded.has(k)) continue;
    const data = generateChunk(cx, cy);
    setChunk(cx, cy, data);
    loaded.add(k);
    budget--;
  }

  if (!current || current.cx !== ccx || current.cy !== ccy) {
    if (current) emit("onExitChunk", { cx: current.cx, cy: current.cy });
    current = { cx: ccx, cy: ccy };
    emit("onEnterChunk", current);
  }

  return Array.from(loaded, (k) => {
    const [cx, cy] = k.split(",").map(Number);
    return { cx, cy };
  });
}
