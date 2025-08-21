import * as miasma from "../miasma/index.js";
import { config } from "../../core/config.js";

// world units per fog tile
const FOG_T = () => miasma.getTileSize();

const MODES = ["laser", "cone", "bubble", "off"];
const state = { modeIndex: 1, angle: 0 }; // start at cone

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
// Cone angle policy: TOTAL angle ∈ [4°, 64°]  → half-angle ∈ [2°, 32°]
const CONE_TOTAL_MIN = 4;
const CONE_TOTAL_MAX = 64;
const CONE_HALF_MIN  = CONE_TOTAL_MIN * 0.5;
const CONE_HALF_MAX  = CONE_TOTAL_MAX * 0.5;

const BeamParams = {
  bubbleRadius: 64,        // px → 128px diameter
  laserLength: 384,        // px
  laserThickness: 8,       // px (visual + hitbox)
  coneLength: 224,         // px
  coneHalfAngleDeg: 32,    // deg (half-angle; default = 64° total)
  budgetPerStamp: 160,     // tiles/update cap for miasma.clearArea
};

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
  // Support either half-angle key or a total-angle convenience key.
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
export function raycast(origin, dir, params = {}) {
  const mode = params.mode || MODES[state.modeIndex];
  const MAX_PER_STEP = BeamParams.budgetPerStamp;
  const T = miasma.getTileSize();
  const TILE_PAD = T * 0.15;
  let clearedFog = 0;

    if (mode === "laser") {
    // Instant “broom” clear with sparkle: core + dual halos + twin sweepers + cross‑broom.
    // Goal: wherever you sweep the laser, ALL miasma in that corridor is gone immediately,
    // with extra twinkle around the edges (but no fat purple stripes left behind).

    const len = BeamParams.laserLength;

    // Axes
    const ux = Math.cos(dir),  uy = Math.sin(dir); // forward
    const nx = -Math.sin(dir), ny = Math.cos(dir); // normal

    // Core (exact visual width)
    const rCore = Math.max(2, BeamParams.laserThickness * 0.5 + TILE_PAD);
    const strideCore = Math.max(T * 0.4, rCore * 0.75);

    // Dual halos (thin buffers outside the core)
    const offHalo1 = rCore + Math.max(T * 0.5, 2);
    const offHalo2 = offHalo1 + Math.max(T * 0.8, 3);
    const rHalo    = Math.max(2, T * 0.55);
    const strideHalo = Math.max(T * 0.8, rCore * 0.9); // denser than before (kills stripes)

    // Twin sweepers (animated edge clears)
    if (typeof raycast._phase !== "number") raycast._phase = 0;
    raycast._phase += 0.18;

    const sweepAmp = offHalo2 + T * 0.9;
    const sweepOffA = Math.sin(raycast._phase) * sweepAmp;
    const sweepOffB = Math.cos(raycast._phase * 0.8 + Math.PI * 0.25) * (sweepAmp * 0.75);
    const rSweep   = Math.max(2, T * 0.7);
    const strideSweep = Math.max(T * 0.9, rCore * 1.1);

    // Cross‑broom: perpendicular mini‑passes across the beam at intervals
    const broomGap = Math.max(T * 1.2, rCore * 1.5);
    const broomSpan = offHalo2 + T * 1.25; // sweep left/right beyond halos
    const broomStep = Math.max(T * 0.8, 3);
    const rBroom    = Math.max(2, T * 0.6);

    // --- Core: perfect match to the line ---
    for (let d = strideCore; d <= len; d += strideCore) {
      const wx = origin.x + ux * d;
      const wy = origin.y + uy * d;
      clearedFog += miasma.clearArea(wx, wy, rCore, Math.max(MAX_PER_STEP, 800));
    }
    // tip reinforcement
    {
      const wx = origin.x + ux * len;
      const wy = origin.y + uy * len;
      clearedFog += miasma.clearArea(wx, wy, rCore, Math.max(MAX_PER_STEP, 800));
    }

    // --- Dual static halos (left/right × 2 rails) ---
    for (let d = strideHalo; d <= len; d += strideHalo) {
      const cx = origin.x + ux * d;
      const cy = origin.y + uy * d;

      // inner halo
      clearedFog += miasma.clearArea(cx + nx * (+offHalo1), cy + ny * (+offHalo1), rHalo, MAX_PER_STEP);
      clearedFog += miasma.clearArea(cx + nx * (-offHalo1), cy + ny * (-offHalo1), rHalo, MAX_PER_STEP);
      // outer halo
      clearedFog += miasma.clearArea(cx + nx * (+offHalo2), cy + ny * (+offHalo2), rHalo, MAX_PER_STEP);
      clearedFog += miasma.clearArea(cx + nx * (-offHalo2), cy + ny * (-offHalo2), rHalo, MAX_PER_STEP);
    }

    // --- Twin animated sweepers (twinkle that moves) ---
    for (let d = strideSweep; d <= len; d += strideSweep) {
      const cx = origin.x + ux * d;
      const cy = origin.y + uy * d;

      clearedFog += miasma.clearArea(cx + nx * sweepOffA, cy + ny * sweepOffA, rSweep, MAX_PER_STEP);
      clearedFog += miasma.clearArea(cx + nx * sweepOffB, cy + ny * sweepOffB, rSweep, MAX_PER_STEP);
    }

    // --- Cross‑broom: perpendicular clears to erase any residual stripes ---
    for (let d = broomGap; d <= len; d += broomGap) {
      const cx = origin.x + ux * d;
      const cy = origin.y + uy * d;

      for (let off = -broomSpan; off <= broomSpan; off += broomStep) {
        const wx = cx + nx * off;
        const wy = cy + ny * off;
        clearedFog += miasma.clearArea(wx, wy, rBroom, MAX_PER_STEP);
      }
    }

    return { hits: [], clearedFog };
  }



    if (mode === "cone") {
    // Proper wedge from origin → tip + the existing tip circle.
    // We stamp growing circles along the centerline so the hitbox exactly fills the cone.
    const len   = BeamParams.coneLength;
    const halfA = (BeamParams.coneHalfAngleDeg * Math.PI) / 180;
    const ux = Math.cos(dir), uy = Math.sin(dir);

    // step along the beam; radius grows linearly with distance
    const step = Math.max(T * 0.9, 6);                 // coarse but seamless
    for (let d = step; d <= len; d += step) {
      const cx = origin.x + ux * d;
      const cy = origin.y + uy * d;
      const r  = Math.max(3, Math.tan(halfA) * d) + TILE_PAD;
      // budget a bit higher near the tip where stamps are largest
      const budget = d > len * 0.6 ? Math.max(MAX_PER_STEP, 1200) : MAX_PER_STEP;
      clearedFog += miasma.clearArea(cx, cy, r, budget);
    }

    // Keep the tip reinforcement so the attachment looks seamless
    const tipX = origin.x + ux * len;
    const tipY = origin.y + uy * len;
    const rTip = Math.max(4, Math.tan(halfA) * len) + TILE_PAD;
    clearedFog += miasma.clearArea(tipX, tipY, rTip, Math.max(MAX_PER_STEP, 2000));

    return { hits: [], clearedFog };
  }






if (mode === "bubble") {
  const r = BeamParams.bubbleRadius + TILE_PAD;
  const Tz = miasma.getTileSize();

  // Snap to the center of the TILE YOU'RE IN (no 1/2‑tile drift)
  const cx = Math.floor(origin.x / Tz) * Tz + Tz * 0.5;
  const cy = Math.floor(origin.y / Tz) * Tz + Tz * 0.5;

  clearedFog += miasma.clearArea(cx, cy, r, Math.max(900, MAX_PER_STEP));
  return { hits: [], clearedFog };
}

 
  return { hits: [], clearedFog };
}

// ---- visuals ----
export function draw(ctx, cam, player) {
  const mode = MODES[state.modeIndex];
  if (mode === "off") return;

  const LIGHT_RGB = "255,240,0";

  ctx.save();
  ctx.translate(-cam.x + player.x, -cam.y + player.y);
  ctx.rotate(state.angle);

  const prevComp = ctx.globalCompositeOperation;
  const prevAlpha = ctx.globalAlpha;
  ctx.globalCompositeOperation = "lighter";

  if (mode === "bubble") {
    const r = BeamParams.bubbleRadius;
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

   } else {
    // Visual CONE: filled sector from origin + the existing tip glow
    const length = BeamParams.coneLength;
    const halfAngle = (BeamParams.coneHalfAngleDeg * Math.PI) / 180;

    // sector body (origin-attached wedge)
    const bodyGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, length);
    bodyGrad.addColorStop(0.0, `rgba(${LIGHT_RGB},0.20)`);
    bodyGrad.addColorStop(1.0, `rgba(${LIGHT_RGB},0.00)`);
    ctx.fillStyle = bodyGrad;

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, length, -halfAngle, +halfAngle, false);
    ctx.closePath();
    ctx.fill();

    // tip circle (kept for the bright focus at the far edge)
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
