import { CHUNK_SIZE, TILE_SIZE } from "./store.js";
import { chunkToWorld } from "../core/coords.js";
import { config } from "../core/config.js";

// --- deterministic RNG per-chunk ---
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
  let h = (config.seed ?? 1337) ^ (cx * 73856093) ^ (cy * 19349663);
  return h >>> 0;
}

// --- tiny helpers ---
const idx = (x, y) => y * CHUNK_SIZE + x;
const inb = (x, y) => x >= 0 && y >= 0 && x < CHUNK_SIZE && y < CHUNK_SIZE;

// Jittered Perlin-ish value using a few octaves of grid noise (cheap)
function noise2(rng, x, y) {
  // 3 hashed layers for blobby thresholds
  const h1 = Math.sin((x * 127.1 + y * 311.7 + rng()) * 12.9898) * 43758.5453;
  const h2 = Math.sin((x * 269.5 + y * 183.3 + rng()) * 78.233) * 43758.5453;
  const h3 = Math.sin((x * 19.19 + y * 47.77 + rng()) * 4.123) * 43758.5453;
  // map to 0..1; weighted blend
  const n = ((h1 - Math.floor(h1)) * 0.55) + ((h2 - Math.floor(h2)) * 0.3) + ((h3 - Math.floor(h3)) * 0.15);
  return n;
}

// Grow from a seed with directional bias for veiny/spire shapes
function growFeature(solid, rng, seedX, seedY, target, biasDir = null, maxSteps = CHUNK_SIZE * CHUNK_SIZE) {
  const q = [];
  const seen = new Set();
  const push = (x, y, d=0) => { const k = (x<<8)|y; if (!inb(x,y) || seen.has(k)) return; seen.add(k); q.push({x,y,d}); };
  push(seedX, seedY, 0);

  let placed = 0;
  while (q.length && placed < target && maxSteps-- > 0) {
    // pick near-front for more blobby, random for spiky
    const i = (rng() < 0.65) ? Math.max(0, q.length - 1 - Math.floor(rng()*4)) : Math.floor(rng()*q.length);
    const {x,y,d} = q.splice(i,1)[0];
    if (!inb(x,y) || solid[idx(x,y)]) continue;

    // chance to place increases with local noise & closeness to seed
    const n = noise2(rng, x*0.7, y*0.7);
    const p = 0.45 + Math.min(0.35, (0.6 - d * 0.02)) + (n - 0.5) * 0.6;
    if (rng() < p) {
      solid[idx(x,y)] = true;
      placed++;
      // branch out
      const dirs = [
        [1,0],[0,1],[-1,0],[0,-1],
        [1,1],[-1,1],[-1,-1],[1,-1],
      ];
      // apply directional bias (spire/vein feel)
      if (biasDir) {
        const [bx,by] = biasDir;
        dirs.sort((a,b) => {
          const sa = a[0]*bx + a[1]*by;
          const sb = b[0]*bx + b[1]*by;
          return (sb - sa); // higher dot first
        });
      }
      for (let k=0; k<dirs.length; k++) {
        // slight randomness to neighbor enqueue
        if (rng() < 0.85 - k*0.05) push(x + dirs[k][0], y + dirs[k][1], d+1);
      }
    }
  }
  return placed;
}

// Carve a guaranteed corridor so chunks remain traversable
function carveCorridor(solid, rng) {
  const vertical = rng() < 0.5;
  const w = CHUNK_SIZE, h = CHUNK_SIZE;
  const width = (rng() < 0.7) ? 1 : 2;      // 1–2 tiles wide path
  const bendiness = 0.55 + rng()*0.25;      // meander factor

  let x = vertical ? Math.floor(rng()*w) : 0;
  let y = vertical ? 0 : Math.floor(rng()*h);

  for (let i = 0; i < (vertical ? h : w); i++) {
    // clear a small cross-section
    for (let a = -width; a <= width; a++) {
      const cx = vertical ? x + a : (x + i);
      const cy = vertical ? (y + i) : y + a;
      if (inb(cx, cy)) solid[idx(cx, cy)] = false;
    }
    // random walk sideways
    if (rng() < bendiness) {
      if (vertical) x = Math.max(0, Math.min(w-1, x + (rng()<0.5?-1:1)));
      else          y = Math.max(0, Math.min(h-1, y + (rng()<0.5?-1:1)));
    }
  }
}

export function generateChunk(cx, cy) {
  const rng = mulberry32(hash(cx, cy));
  const solid = new Array(CHUNK_SIZE * CHUNK_SIZE).fill(false);

  // --- choose a target rock coverage per chunk (0.40..0.60) ---
  const targetCov = 0.40 + rng() * 0.20;
  const totalTiles = CHUNK_SIZE * CHUNK_SIZE;
  const targetTiles = Math.floor(totalTiles * targetCov);

  // --- multi-scale features: blobs, spires, veins ---
  // counts scale with chunk; keep light to stay fast
  const features = [];
  const addFeat = (kind, count) => { for (let i=0;i<count;i++) features.push(kind); };
  addFeat("blob",  1 + Math.floor(rng()*3));   // 1–3 blobby areas
  addFeat("spire", Math.floor(rng()*3));       // 0–2 spires
  addFeat("vein",  1 + Math.floor(rng()*2));   // 1–2 veins

  let placed = 0;
  for (const kind of features) {
    // pick seed
    const sx = Math.floor(rng()*CHUNK_SIZE);
    const sy = Math.floor(rng()*CHUNK_SIZE);
    // scale per feature
    const remain = Math.max(0, targetTiles - placed);
    if (remain <= 0) break;
    let goal = 0;
    let bias = null;

    if (kind === "blob") {
      goal = Math.max(10, Math.floor(remain * (0.15 + rng()*0.10))); // medium blob
      bias = null; // isotropic
    } else if (kind === "spire") {
      goal = Math.max(6, Math.floor(remain * (0.08 + rng()*0.05)));
      // spire bias roughly outward from center for “pointing” look
      const cxw = CHUNK_SIZE/2, cyw = CHUNK_SIZE/2;
      const vx = Math.sign(sx - cxw) || (rng()<0.5?-1:1);
      const vy = Math.sign(sy - cyw) || (rng()<0.5?-1:1);
      bias = [vx, vy];
    } else { // vein
      goal = Math.max(8, Math.floor(remain * (0.10 + rng()*0.06)));
      // vein bias along a random axis
      bias = (rng() < 0.5) ? [1, 0] : [0, 1];
      if (rng() < 0.5) { bias[0] *= -1; bias[1] *= -1; }
    }

    placed += growFeature(solid, rng, sx, sy, goal, bias);
    if (placed >= targetTiles) break;
  }

  // If we undershot (rare), top up with small blobs
  let safety = 200;
  while (placed < targetTiles && safety-- > 0) {
    const sx = Math.floor(rng()*CHUNK_SIZE);
    const sy = Math.floor(rng()*CHUNK_SIZE);
    placed += growFeature(solid, rng, sx, sy, Math.max(4, Math.floor((targetTiles - placed) * 0.2)));
  }

  // Carve a meandering corridor to keep traversal viable
  carveCorridor(solid, rng);

  // Optional light erosion to soften edges
  for (let pass=0; pass<1; pass++) {
    for (let y=1; y<CHUNK_SIZE-1; y++) {
      for (let x=1; x<CHUNK_SIZE-1; x++) {
        const i = idx(x,y);
        if (!solid[i]) continue;
        // if almost surrounded by empty, chance to chip away
        let filled = 0;
        filled += solid[idx(x+1,y)] ? 1:0;
        filled += solid[idx(x-1,y)] ? 1:0;
        filled += solid[idx(x,y+1)] ? 1:0;
        filled += solid[idx(x,y-1)] ? 1:0;
        if (filled <= 1 && rng() < 0.25) solid[i] = false;
      }
    }
  }

  // Build tiles array (id: 1 = rock), preserve existing shape
  const tiles = new Array(CHUNK_SIZE * CHUNK_SIZE);
  for (let y=0; y<CHUNK_SIZE; y++) {
    for (let x=0; x<CHUNK_SIZE; x++) {
      const i = idx(x,y);
      tiles[i] = solid[i] ? { id: 1, solid: true } : { id: 0, solid: false };
    }
  }

  // Spawn a few representative rock entities (for future visuals/props)
  const entities = [];
  const [baseWX, baseWY] = chunkToWorld(cx, cy, CHUNK_SIZE, TILE_SIZE);
  const wantEnts = 2 + Math.floor(Math.min(6, placed / 40));
  let tries = 0, made = 0;
  while (made < wantEnts && tries++ < 200) {
    const x = Math.floor(rng()*CHUNK_SIZE);
    const y = Math.floor(rng()*CHUNK_SIZE);
    if (!solid[idx(x,y)]) continue;
    entities.push({
      type: "rock",
      wx: baseWX + (x + 0.5) * TILE_SIZE,
      wy: baseWY + (y + 0.5) * TILE_SIZE,
      size: 0.6 + rng()*1.8  // hint for future draw scale
    });
    made++;
  }

  return { tiles, entities };
}

export function evictChunk(_cx, _cy, _data) {
  // placeholder for future resource cleanup (e.g., pooled sprites)
}
