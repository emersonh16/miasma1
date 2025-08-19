// Public surface kept tiny so internals can change freely.
import { worldToTile } from "../../core/coords.js";

const TILE_SIZE = 64; // world units per tile
const S = { density: new Map() }; // key "x,y" -> 0..255

export function init() { /* seed buffers later */ }

export function sample(wx, wy) {
  const [tx, ty] = worldToTile(wx, wy, TILE_SIZE);
  // Simple radial gradient placeholder (dense away from origin).
  const d = Math.min(255, Math.floor(Math.hypot(tx, ty) * 0.2));
  return d;
}

export function clearArea(wx, wy, r, amt = 64) {
  const [tx, ty] = worldToTile(wx, wy, TILE_SIZE);
  // Placeholder: no persistence yet; return fake cleared count.
  return Math.max(0, Math.floor((r / TILE_SIZE) * amt * 0.1));
}

export function update(dt) {
  // Wind/regrow will live here; empty for v0.
}

export function draw(ctx, cam, w, h) {
  // Lightweight overlay preview anchored to world space so it scrolls
  // opposite to camera movement. Origin is at world (0,0).
  const cx = w / 2 - cam.x;
  const cy = h / 2 - cam.y;
  const grd = ctx.createRadialGradient(cx, cy, 64, cx, cy, Math.hypot(w, h) / 1.2);
  grd.addColorStop(0, "rgba(128,0,180,0.05)");
  grd.addColorStop(1, "rgba(128,0,180,0.35)");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, w, h);
}
