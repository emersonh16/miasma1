import * as miasma from "../miasma/index.js";
import { config } from "../../core/config.js";
import { iterEntitiesInAABB } from "../../world/store.js";

// world units per fog tile
const FOG_T = () => miasma.getTileSize();

// Discrete-only modes, ordered for wheel stepping
const MODES = ["off", "bubbleMin", "bubbleMax", "cone", "laser"];
const state = { modeIndex: 1, angle: 0 }; // start near bubbleMin

export function getMode() { return MODES[state.modeIndex]; }
export function setMode(m) {
  const i = MODES.indexOf((m || "").toLowerCase());
  if (i !== -1) state.modeIndex = i;
}
export function modeUp(steps = 1)   { state.modeIndex = Math.min(MODES.length - 1, state.modeIndex + steps); }
export function modeDown(steps = 1) { state.modeIndex = Math.max(0, state.modeIndex - steps); }
export function setAngle(rad) { state.angle = rad || 0; }
export function getAngle()   { return state.angle; }

// ---- Live-tunable beam params (pixels in world space) ----
const CONE_TOTAL_MIN = 4;
const CONE_TOTAL_MAX = 64;
const CONE_HALF_MIN  = CONE_TOTAL_MIN * 0.5;
const CONE_HALF_MAX  = CONE_TOTAL_MAX * 0.5;

const BeamParams = {
  bubbleMinRadius: 48,     // px → 96px diameter
  bubbleMaxRadius: 128,    // px → 256px diameter
  laserLength: 512,        // px (longer default)
  laserThickness: 12,      // px (thicker default)
  coneLength: 224,         // px
  coneHalfAngleDeg: 32,    // deg (half-angle; default = 64° total)
  budgetPerStamp: 160,     // tiles/update cap for miasma.clearArea
};

// perf stats (updated each raycast)
const BeamStats = { stamps: 0, clearedTiles: 0 };
export function getStats() { return { ...BeamStats }; }

// --- shared helpers for hitboxes ---
function clearBubble(origin, radius, budget) {
  return miasma.clearArea(origin.x, origin.y, radius, budget);
}

function clearCone(origin, dir, length, halfAngle, budget) {
  const T = miasma.getTileSize();
  let cleared = 0;
  const ux = Math.cos(dir), uy = Math.sin(dir);
  for (let d = T; d <= length; d += T) {
    const cx = origin.x + ux * d;
    const cy = origin.y + uy * d;
    const r  = Math.max(3, Math.tan(halfAngle) * d);
    cleared += miasma.clearArea(cx, cy, r, budget);
  }
  return cleared;
}

function clampConeHalf(deg) {
  if (!Number.isFinite(deg)) return BeamParams.coneHalfAngleDeg;
  return Math.max(CONE_HALF_MIN, Math.min(CONE_HALF_MAX, deg));
}
function clampConeTotal(totalDeg) {
  if (!Number.isFinite(totalDeg)) return BeamParams.coneHalfAngleDeg * 2;
  const t = Math.max(CONE_TOTAL_MIN, Math.min(CONE_TOTAL_MAX, totalDeg));
  return t;
}

export function setParams(patch = {}) {
  const p = { ...patch };
  if ("coneAngleTotalDeg" in p) {
    const total = clampConeTotal(p.coneAngleTotalDeg);
    p.coneHalfAngleDeg = total * 0.5;
    delete p.coneAngleTotalDeg;
  }
  if ("coneHalfAngleDeg" in p) {
    p.coneHalfAngleDeg = clampConeHalf(p.coneHalfAngleDeg);
  }
  Object.assign(BeamParams, p);
}
export function getParams() { return { ...BeamParams, coneAngleTotalDeg: BeamParams.coneHalfAngleDeg * 2 }; }

// ---- hit test & clearing (hitbox matches visuals) ----
export function raycast(origin, dir) {
  const mode = MODES[state.modeIndex];
  const MAX_PER_STEP = BeamParams.budgetPerStamp;
  const T = miasma.getTileSize();
  const TILE_PAD = T * 0.15;
  let clearedFog = 0;
  BeamStats.stamps = 0;
  BeamStats.clearedTiles = 0;

  if (mode === "off") return { hits: [], clearedFog };

  if (mode === "laser") {
    const len = BeamParams.laserLength;
    const ux = Math.cos(dir),  uy = Math.sin(dir); // forward
    const nx = -Math.sin(dir), ny = Math.cos(dir); // normal

    const rCore = Math.max(2, BeamParams.laserThickness * 0.5 + TILE_PAD);
    const strideCore = Math.max(T * 0.4, rCore * 0.75);

    const offHalo1 = rCore + Math.max(T * 0.5, 2);
    const offHalo2 = offHalo1 + Math.max(T * 0.8, 3);
    const rHalo    = Math.max(2, T * 0.55);
    const strideHalo = Math.max(T * 0.8, rCore * 0.9);

    if (typeof raycast._phase !== "number") raycast._phase = 0;
    raycast._phase += 0.18;

    const sweepAmp = offHalo2 + T * 0.9;
    const sweepOffA = Math.sin(raycast._phase) * sweepAmp;
    const sweepOffB = Math.cos(raycast._phase * 0.8 + Math.PI * 0.25) * (sweepAmp * 0.75);
    const rSweep   = Math.max(2, T * 0.7);
    const strideSweep = Math.max(T * 0.9, rCore * 1.1);

    const broomGap = Math.max(T * 1.2, rCore * 1.5);
    const broomSpan = offHalo2 + T * 1.25;
    const broomStep = Math.max(T * 0.8, 3);
    const rBroom    = Math.max(2, T * 0.6);

    // Core
    for (let d = strideCore; d <= len; d += strideCore) {
      const wx = origin.x + ux * d;
      const wy = origin.y + uy * d;
      const n = miasma.clearArea(wx, wy, rCore, Math.max(MAX_PER_STEP, 800));
      clearedFog += n; BeamStats.clearedTiles += n; BeamStats.stamps++;
    }
    // Tip punch
    {
      const wx = origin.x + ux * len;
      const wy = origin.y + uy * len;
      const n = miasma.clearArea(wx, wy, rCore, Math.max(MAX_PER_STEP, 800));
      clearedFog += n; BeamStats.clearedTiles += n; BeamStats.stamps++;
    }

    // Halos
    for (let d = strideHalo; d <= len; d += strideHalo) {
      const cx = origin.x + ux * d;
      const cy = origin.y + uy * d;
      const pts = [
        [cx + nx * (+offHalo1), cy + ny * (+offHalo1)],
        [cx + nx * (-offHalo1), cy + ny * (-offHalo1)],
        [cx + nx * (+offHalo2), cy + ny * (+offHalo2)],
        [cx + nx * (-offHalo2), cy + ny * (-offHalo2)],
      ];
      for (const [px, py] of pts) {
        const n = miasma.clearArea(px, py, rHalo, MAX_PER_STEP);
        clearedFog += n; BeamStats.clearedTiles += n; BeamStats.stamps++;
      }
    }

    // Sweeps
    for (let d = strideSweep; d <= len; d += strideSweep) {
      const cx = origin.x + ux * d;
      const cy = origin.y + uy * d;
      const pts = [
        [cx + nx * sweepOffA, cy + ny * sweepOffA],
        [cx + nx * sweepOffB, cy + ny * sweepOffB],
      ];
      for (const [px, py] of pts) {
        const n = miasma.clearArea(px, py, rSweep, MAX_PER_STEP);
        clearedFog += n; BeamStats.clearedTiles += n; BeamStats.stamps++;
      }
    }

    // Broom pass (fills gaps)
    for (let d = broomGap; d <= len; d += broomGap) {
      const cx = origin.x + ux * d;
      const cy = origin.y + uy * d;
      for (let off = -broomSpan; off <= broomSpan; off += broomStep) {
        const wx = cx + nx * off;
        const wy = cy + ny * off;
        const n = miasma.clearArea(wx, wy, rBroom, MAX_PER_STEP);
        clearedFog += n; BeamStats.clearedTiles += n; BeamStats.stamps++;
      }
    }

    // --- DAMAGE pass (laser only) ---
    const LASER_DPS = (config?.beam?.laser?.dps ?? 15);
    const now = performance.now();
    if (typeof raycast._lastTime !== "number") raycast._lastTime = now;
    const dt = Math.min(0.05, Math.max(0, (now - raycast._lastTime) / 1000));
    raycast._lastTime = now;

    // Beam AABB
    const x0 = origin.x, y0 = origin.y;
    const x1 = origin.x + ux * len, y1 = origin.y + uy * len;
    const pad = offHalo2 + T * 1.5;
    const minX = Math.min(x0, x1) - pad, maxX = Math.max(x0, x1) + pad;
    const minY = Math.min(y0, y1) - pad, maxY = Math.max(y0, y1) + pad;

    for (const e of iterEntitiesInAABB(minX, minY, maxX, maxY)) {
      if (e?.type !== "enemy" || typeof e.health !== "number") continue;
      const vx = e.x - x0, vy = e.y - y0;
      const tProj = vx * ux + vy * uy;
      if (tProj < 0 || tProj > len) continue;
      const perp = Math.abs(vx * uy - vy * ux);
      const er = (e.r ?? 0);
      if (perp <= (rCore) + er) {
        e.health -= LASER_DPS * dt;
        if (e.health < 0) e.health = 0;
      }
    }

    return { hits: [], clearedFog };
  }

  if (mode === "cone") {
    const len   = BeamParams.coneLength;
    const halfA = (BeamParams.coneHalfAngleDeg * Math.PI) / 180;
    const ux = Math.cos(dir), uy = Math.sin(dir);

    const step = Math.max(T * 0.9, 6);
    for (let d = step; d <= len; d += step) {
      const cx = origin.x + ux * d;
      const cy = origin.y + uy * d;
      const r  = Math.max(3, Math.tan(halfA) * d) + TILE_PAD;
      const budget = d > len * 0.6 ? Math.max(MAX_PER_STEP, 1200) : MAX_PER_STEP;
      const n = miasma.clearArea(cx, cy, r, budget);
      clearedFog += n; BeamStats.clearedTiles += n; BeamStats.stamps++;
    }

    const tipX = origin.x + ux * len;
    const tipY = origin.y + uy * len;
    const rTip = Math.max(4, Math.tan(halfA) * len) + TILE_PAD;
    {
      const n = miasma.clearArea(tipX, tipY, rTip, Math.max(MAX_PER_STEP, 2000));
      clearedFog += n; BeamStats.clearedTiles += n; BeamStats.stamps++;
    }
    return { hits: [], clearedFog };
  }

  if (mode === "bubbleMin" || mode === "bubbleMax") {
    const r0 = mode === "bubbleMin" ? BeamParams.bubbleMinRadius : BeamParams.bubbleMaxRadius;
    const r = r0 + TILE_PAD;
    const Tz = miasma.getTileSize();
    const cx = Math.floor(origin.x / Tz) * Tz + Tz * 0.5;
    const cy = Math.floor(origin.y / Tz) * Tz + Tz * 0.5;
    {
      const n = miasma.clearArea(cx, cy, r, Math.max(900, MAX_PER_STEP));
      clearedFog += n; BeamStats.clearedTiles += n; BeamStats.stamps++;
    }
    return { hits: [], clearedFog };
  }

  return { hits: [], clearedFog };
}

// ---- visuals ----
export function draw(ctx, cam, player) {
  const mode = MODES[state.modeIndex];

  ctx.save();
  ctx.translate(-cam.x + player.x, -cam.y + player.y);
  ctx.rotate(state.angle);

  const prevComp = ctx.globalCompositeOperation;
  const prevAlpha = ctx.globalAlpha;
  ctx.globalCompositeOperation = "lighter";

  const LIGHT_RGB = "255,240,0";

  if (mode === "off") {
    ctx.globalCompositeOperation = prevComp;
    ctx.globalAlpha = prevAlpha;
    ctx.restore();
    return;
  }

  if (mode === "bubbleMin" || mode === "bubbleMax") {
    const r = (mode === "bubbleMin") ? BeamParams.bubbleMinRadius : BeamParams.bubbleMaxRadius;
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0.0, `rgba(${LIGHT_RGB},0.30)`);
    g.addColorStop(1.0, `rgba(${LIGHT_RGB},0.00)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
  } else if (mode === "laser") {
    const len = BeamParams.laserLength;
    const thick = BeamParams.laserThickness;
    ctx.lineCap = "round";

    ctx.strokeStyle = `rgba(${LIGHT_RGB},0.25)`;
    ctx.lineWidth = thick * 2.25;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(len, 0); ctx.stroke();

    ctx.strokeStyle = `rgba(${LIGHT_RGB},0.6)`;
    ctx.lineWidth = thick * 1.25;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(len, 0); ctx.stroke();

    ctx.strokeStyle = `rgba(${LIGHT_RGB},1.0)`;
    ctx.lineWidth = thick;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(len, 0); ctx.stroke();

    const tipR = Math.max(thick * 1.6, 6);
    const tip = ctx.createRadialGradient(len, 0, 0, len, 0, tipR * 2);
    tip.addColorStop(0, `rgba(${LIGHT_RGB},0.9)`);
    tip.addColorStop(1, `rgba(${LIGHT_RGB},0.0)`);
    ctx.fillStyle = tip;
    ctx.beginPath(); ctx.arc(len, 0, tipR * 2, 0, Math.PI * 2); ctx.fill();
  } else if (mode === "cone") {
    const length = BeamParams.coneLength;
    const halfAngle = (BeamParams.coneHalfAngleDeg * Math.PI) / 180;

    const bodyGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, length);
    bodyGrad.addColorStop(0.0, `rgba(${LIGHT_RGB},0.20)`);
    bodyGrad.addColorStop(1.0, `rgba(${LIGHT_RGB},0.00)`);
    ctx.fillStyle = bodyGrad;

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, length, -halfAngle, +halfAngle, false);
    ctx.closePath();
    ctx.fill();

    const rTip = Math.max(8, Math.tan(halfAngle) * length);
    const tip = ctx.createRadialGradient(length, 0, 0, length, 0, rTip);
    tip.addColorStop(0.0, `rgba(${LIGHT_RGB},0.30)`);
    tip.addColorStop(1.0, `rgba(${LIGHT_RGB},0.00)`);
    ctx.fillStyle = tip;
    ctx.beginPath();
    ctx.arc(length, 0, rTip, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalCompositeOperation = prevComp;
  ctx.globalAlpha = prevAlpha;
  ctx.restore();
}
