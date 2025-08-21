// src/systems/miasma/index.js
// Fog-of-war using viewport-aligned typed array and mask canvas.

import { worldToTile } from "../../core/coords.js";
import { config } from "../../core/config.js";

const MC = (config.miasma ?? {});
const TILE_SIZE = MC.tileSize ?? 8;
const PAD = MC.regrowPad ?? (MC.marginTiles ?? 6);
const FOG_COLOR = MC.color ?? "rgba(128,0,180,1.0)";

function parseRGB(str) {
  const m = str.replace(/\s+/g, "").match(/rgba?\((\d+),(\d+),(\d+)/i);
  return m ? [m[1] | 0, m[2] | 0, m[3] | 0] : [128, 0, 180];
}
const [FOG_R, FOG_G, FOG_B] = parseRGB(FOG_COLOR);

const S = {
  cols: 0, rows: 0,
  ox: 0, oy: 0,
  viewW: 0, viewH: 0,
  fxTiles: 0, fyTiles: 0,
  fog: new Uint8Array(0),
  maskCanvas: /** @type {HTMLCanvasElement} */ (document.createElement("canvas")),
  maskCtx: /** @type {CanvasRenderingContext2D} */ (null),
  maskData: /** @type {ImageData|null} */ (null)
};

S.maskCtx = S.maskCanvas.getContext("2d", { alpha: true });

function refreshMask() {
  if (!S.maskData) return;
  const data = S.maskData.data;
  const len = S.fog.length;
  for (let i = 0; i < len; i++) {
    const idx = i * 4;
    data[idx] = FOG_R;
    data[idx + 1] = FOG_G;
    data[idx + 2] = FOG_B;
    data[idx + 3] = S.fog[i] ? 255 : 0;
  }
  S.maskCtx.putImageData(S.maskData, 0, 0);
}

export function init(viewW, viewH, centerWX = 0, centerWY = 0) {
  S.viewW = viewW; S.viewH = viewH;
  const viewCols = Math.ceil(viewW / TILE_SIZE);
  const viewRows = Math.ceil(viewH / TILE_SIZE);
  S.cols = viewCols + PAD * 2;
  S.rows = viewRows + PAD * 2;
  S.fog = new Uint8Array(S.cols * S.rows);
  S.fog.fill(1);
  S.maskCanvas.width = S.cols;
  S.maskCanvas.height = S.rows;
  S.maskCtx.imageSmoothingEnabled = false;
  S.maskData = S.maskCtx.createImageData(S.cols, S.rows);
  const cx = Math.floor(centerWX / TILE_SIZE);
  const cy = Math.floor(centerWY / TILE_SIZE);
  S.ox = cx - Math.floor(S.cols / 2);
  S.oy = cy - Math.floor(S.rows / 2);
  S.fxTiles = 0;
  S.fyTiles = 0;
  refreshMask();
}

export function getTileSize() { return TILE_SIZE; }
export function getOrigin() { return { ox: S.ox, oy: S.oy }; }

export function sample(wx, wy) {
  const [tx, ty] = worldToTile(wx, wy, TILE_SIZE);
  const fx = Math.floor(tx - S.fxTiles);
  const fy = Math.floor(ty - S.fyTiles);
  const ix = fx - S.ox;
  const iy = fy - S.oy;
  if (ix < 0 || iy < 0 || ix >= S.cols || iy >= S.rows) return 1;
  return S.fog[iy * S.cols + ix];
}

export function clearArea(wx, wy, r, _budget = 0) {
  const [cx, cy] = worldToTile(wx, wy, TILE_SIZE);
  const tr = Math.ceil(r / TILE_SIZE);
  const r2 = r * r;
  for (let dy = -tr; dy <= tr; dy++) {
    for (let dx = -tr; dx <= tr; dx++) {
      const tx = cx + dx;
      const ty = cy + dy;
      const centerX = (tx + 0.5) * TILE_SIZE;
      const centerY = (ty + 0.5) * TILE_SIZE;
      const dxw = centerX - wx;
      const dyw = centerY - wy;
      if (dxw * dxw + dyw * dyw > r2) continue;
      const fx = Math.floor(tx - S.fxTiles);
      const fy = Math.floor(ty - S.fyTiles);
      const ix = fx - S.ox;
      const iy = fy - S.oy;
      if (ix < 0 || iy < 0 || ix >= S.cols || iy >= S.rows) continue;
      S.fog[iy * S.cols + ix] = 0;
    }
  }
  refreshMask();
}

function slide(dx, dy) {
  const { cols, rows } = S;
  const old = S.fog;
  const next = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    const srcY = y - dy;
    if (srcY < 0 || srcY >= rows) continue;
    for (let x = 0; x < cols; x++) {
      const srcX = x - dx;
      if (srcX < 0 || srcX >= cols) continue;
      next[y * cols + x] = old[srcY * cols + srcX];
    }
  }
  S.fog = next;
  refreshMask();
}

export function update(dt, centerWX, centerWY, _worldMotion = { x: 0, y: 0 }, viewW = S.viewW, viewH = S.viewH) {
  if (_worldMotion) {
    S.fxTiles += (_worldMotion.x || 0) / TILE_SIZE;
    S.fyTiles += (_worldMotion.y || 0) / TILE_SIZE;
  }
  if (viewW !== S.viewW || viewH !== S.viewH) {
    init(viewW, viewH, centerWX, centerWY);
    return;
  }
  const cx = Math.floor(centerWX / TILE_SIZE);
  const cy = Math.floor(centerWY / TILE_SIZE);
  const newOx = cx - Math.floor(S.cols / 2);
  const newOy = cy - Math.floor(S.rows / 2);
  const dx = newOx - S.ox;
  const dy = newOy - S.oy;
  if (dx || dy) slide(dx, dy);
  S.ox = newOx;
  S.oy = newOy;
}

export function draw(ctx, cam, w, h) {
  ctx.save();
  ctx.translate(-cam.x + w / 2, -cam.y + h / 2);
  const pxLeft = S.ox * TILE_SIZE;
  const pxTop = S.oy * TILE_SIZE;
  const pxWidth = S.cols * TILE_SIZE;
  const pxHeight = S.rows * TILE_SIZE;
  ctx.drawImage(S.maskCanvas, pxLeft, pxTop, pxWidth, pxHeight);
  ctx.restore();
}

