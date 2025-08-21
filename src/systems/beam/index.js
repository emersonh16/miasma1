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
    // Pixel-safe cone clear:
    // - sub-tile scanlines (T/4) across the wedge body
    // - partial-ellipse tip sampled at T/4
    // Guarantees: any drawn gold pixel sits on at least one cleared tile.

    const len   = BeamParams.coneLength;
    const halfA = (BeamParams.coneHalfAngleDeg * Math.PI) / 180;

    const ux = Math.cos(dir),  uy = Math.sin(dir);   // beam axis
    const nx = -Math.sin(dir), ny = Math.cos(dir);   // beam normal

    // Finer sampling than before
    const stepD = Math.max(T * 0.25, 1);   // forward step (≈ 1px with T=4)
    const stepW = Math.max(T * 0.25, 1);   // cross step
    const tinyR = Math.max(0.28 * T + TILE_PAD, 1.75); // small overlap radius

    // Tip lens params (MUST mirror draw())
    const tipArcFrac = 0.65;
    const tipRxFrac  = 0.55;

    // Dynamic cap (bounded but scales with cone size)
    const worst = ((len / stepD) * (2 * Math.tan(halfA) * len / stepW)) | 0;
    const MAX_STAMPS = Math.min(Math.max(40000, worst + 4000), 200000);
    let stamps = 0;

    // 1) BODY — dense scanlines
    for (let d = 0; d <= len && stamps < MAX_STAMPS; d += stepD) {
      const halfW = Math.tan(halfA) * d + 1e-6; // epsilon to include boundary
      const cx = origin.x + ux * d;
      const cy = origin.y + uy * d;

      // sweep across
      let off = -halfW;
      for (; off <= halfW && stamps < MAX_STAMPS; off += stepW) {
        const wx = cx + nx * off;
        const wy = cy + ny * off;
        clearedFog += miasma.clearArea(wx, wy, tinyR, MAX_PER_STEP);
        stamps++;
      }
      // force exact edge stamps
      if (halfW > 0 && stamps < MAX_STAMPS) {
        clearedFog += miasma.clearArea(cx + nx * (-halfW), cy + ny * (-halfW), tinyR, MAX_PER_STEP); stamps++;
        clearedFog += miasma.clearArea(cx + nx * ( halfW), cy + ny * ( halfW), tinyR, MAX_PER_STEP);  stamps++;
      }
    }

    // 2) TIP — partial ellipse sampled at T/4 spacing
    {
      const farHalfW = Math.tan(halfA) * len;
      const ry = Math.max(4, farHalfW);
      const rx = Math.max(4, ry * tipRxFrac);
      const alpha = tipArcFrac * (Math.PI / 2);

      const tipX = origin.x + ux * len;
      const tipY = origin.y + uy * len;

      const minEx = -rx, maxEx = rx;
      const minEy = -ry, maxEy = ry;

      const stepEx = stepW;
      const stepEy = stepW;

      for (let ey = minEy; ey <= maxEy && stamps < MAX_STAMPS; ey += stepEy) {
        for (let ex = minEx; ex <= maxEx && stamps < MAX_STAMPS; ex += stepEx) {
          // inside ellipse?
          if ((ex*ex)/(rx*rx) + (ey*ey)/(ry*ry) > 1) continue;
          // within partial arc window
          const ang = Math.atan2(ey, ex);
          if (ang < -alpha || ang > +alpha) continue;

          const wx = tipX + ux * ex + nx * ey;
          const wy = tipY + uy * ex + ny * ey;
          clearedFog += miasma.clearArea(wx, wy, tinyR, MAX_PER_STEP);
          stamps++;
        }
      }
      // center reinforcement
      if (stamps < MAX_STAMPS) clearedFog += miasma.clearArea(tipX, tipY, tinyR, MAX_PER_STEP);
    }

    return { hits: [], clearedFog };
  }




if (mode === "bubble") {
  const r = BeamParams.bubbleRadius + TILE_PAD;
  const T = miasma.getTileSize();

  // snap to tile center so the cleared hole aligns visually with the drawn bubble
  const cx = Math.round(origin.x / T) * T + T * 0.5;
  const cy = Math.round(origin.y / T) * T + T * 0.5;

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
    const length = BeamParams.coneLength;
    const halfAngle = (BeamParams.coneHalfAngleDeg * Math.PI) / 180;
    const farHalfWidth = Math.tan(halfAngle) * length;

    const tipArcFrac = 0.65;
    const tipRxFrac  = 0.55;
    const rx = Math.max(8, farHalfWidth * tipRxFrac);
    const ry = Math.max(8, farHalfWidth);
    const alpha = tipArcFrac * (Math.PI / 2);

    const base = ctx.createLinearGradient(0, 0, length, 0);
    base.addColorStop(0.0, `rgba(${LIGHT_RGB},0.30)`);
    base.addColorStop(1.0, `rgba(${LIGHT_RGB},0.00)`);
    ctx.fillStyle = base;

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(length, -farHalfWidth);
    ctx.lineTo(length,  farHalfWidth);
    ctx.closePath();
    ctx.fill();

    const lens = ctx.createRadialGradient(length, 0, Math.max(2, rx * 0.2), length, 0, Math.max(rx, ry));
    lens.addColorStop(0.0, `rgba(${LIGHT_RGB},0.28)`);
    lens.addColorStop(1.0, `rgba(${LIGHT_RGB},0.00)`);
    ctx.fillStyle = lens;

    ctx.beginPath();
    ctx.ellipse(length, 0, rx, ry, 0, -alpha, +alpha, false);
    ctx.closePath();
    ctx.fill();
  }

  ctx.globalCompositeOperation = prevComp;
  ctx.globalAlpha = prevAlpha;
  ctx.restore();
}
