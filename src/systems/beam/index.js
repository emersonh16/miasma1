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
const BeamParams = {
  bubbleRadius: 64,        // px → 128px diameter
  laserLength: 384,        // px
  laserThickness: 8,       // px (visual + hitbox)
  coneLength: 224,         // px
  coneHalfAngleDeg: 64,    // deg (128° total)
  budgetPerStamp: 160,     // tiles/update cap for miasma.clearArea
};

export function setParams(patch = {}) { Object.assign(BeamParams, patch); }
export function getParams() { return { ...BeamParams }; }

// ---- hit test & clearing (hitbox matches visuals) ----
export function raycast(origin, dir, params = {}) {
  const mode = params.mode || MODES[state.modeIndex];
  const MAX_PER_STEP = BeamParams.budgetPerStamp;
  const T = miasma.getTileSize();
  const TILE_PAD = T * 0.15;
  let clearedFog = 0;

  if (mode === "laser") {
    const len = BeamParams.laserLength;
    const r = Math.max(2, BeamParams.laserThickness * 0.5 + TILE_PAD);
    const stride = Math.max(T * 0.5, r * 0.9);
    for (let d = stride; d <= len; d += stride) {
      const wx = origin.x + Math.cos(dir) * d;
      const wy = origin.y + Math.sin(dir) * d;
      clearedFog += miasma.clearArea(wx, wy, r, MAX_PER_STEP);
    }
    // tip reinforcement
    {
      const wx = origin.x + Math.cos(dir) * len;
      const wy = origin.y + Math.sin(dir) * len;
      clearedFog += miasma.clearArea(wx, wy, r, MAX_PER_STEP);
    }
    return { hits: [], clearedFog };
  }

  if (mode === "cone") {
    // TILE-ACCURATE CLEAR to guarantee: "if you see gold, there is NO purple".
    // We iterate tile-sized samples inside the exact flashlight shape (wedge + partial ellipse tip)
    // and stamp a *single tile* at each sample. This aligns cleared tiles 1:1 with drawn pixels (at tile resolution).
    const len   = BeamParams.coneLength;
    const halfA = (BeamParams.coneHalfAngleDeg * Math.PI) / 180;

    const Tsize = T;                         // tile size in px
    const stepD = Math.max(Tsize, 1);        // march along-beam in tile steps
    const stepW = Math.max(Tsize, 1);        // sweep across-beam in tile steps
    const tinyR = Math.max(0.51 * Tsize, 2); // small radius so exactly the touched tile clears

    const ux = Math.cos(dir),  uy = Math.sin(dir);   // beam axis
    const nx = -Math.sin(dir), ny = Math.cos(dir);   // beam normal

    // Tip lens parameters (match draw)
    const tipArcFrac = 0.65;
    const tipRxFrac  = 0.55;
    const farHalfW   = Math.tan(halfA) * len;
    const ry         = Math.max(8, farHalfW);              // across-beam radius at tip
    const rx         = Math.max(8, ry * tipRxFrac);        // along-beam radius at tip
    const alpha      = tipArcFrac * (Math.PI / 2);

    const MAX_STAMPS = Math.max(4000, BeamParams.budgetPerStamp * 16);
    let stamps = 0;

    // 1) WEDGE BODY: scan along the beam; at each depth d, sweep across full wedge width.
    for (let d = 0; d <= len && stamps < MAX_STAMPS; d += stepD) {
      const halfW = Math.tan(halfA) * d;
      const cx = origin.x + ux * d;
      const cy = origin.y + uy * d;

      // across sweep
      for (let off = -halfW; off <= halfW && stamps < MAX_STAMPS; off += stepW) {
        const wx = cx + nx * off;
        const wy = cy + ny * off;
        // Clear exactly the tile containing this sample (no gaps between gold and fog)
        clearedFog += miasma.clearArea(wx, wy, tinyR, MAX_PER_STEP);
        stamps++;
      }
    }

    // 2) TIP LENS: fill the partial ellipse cap with tile-sized samples.
    {
      const tipX = origin.x + ux * len;
      const tipY = origin.y + uy * len;

      // iterate a tile grid over the ellipse's local bounding box
      const minEx = -rx, maxEx = rx;
      const minEy = -ry, maxEy = ry;

      // tile-aligned steps in ellipse space
      const stepEx = stepW;
      const stepEy = stepW;

      for (let ey = minEy; ey <= maxEy && stamps < MAX_STAMPS; ey += stepEy) {
        for (let ex = minEx; ex <= maxEx && stamps < MAX_STAMPS; ex += stepEx) {
          // inside the ellipse?
          if ((ex*ex)/(rx*rx) + (ey*ey)/(ry*ry) > 1) continue;
          // within the partial arc (not full half-ellipse)
          const ang = Math.atan2(ey, ex);
          if (ang < -alpha || ang > +alpha) continue;

          // world position for this ellipse sample
          const wx = tipX + ux * ex + nx * ey;
          const wy = tipY + uy * ex + ny * ey;

          clearedFog += miasma.clearArea(wx, wy, tinyR, MAX_PER_STEP);
          stamps++;
        }
      }
    }

    return { hits: [], clearedFog };
  }


  if (mode === "bubble") {
    const r = BeamParams.bubbleRadius + TILE_PAD;
    clearedFog += miasma.clearArea(origin.x, origin.y, r, Math.max(900, MAX_PER_STEP));
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
