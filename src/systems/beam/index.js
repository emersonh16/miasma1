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

// ---- shared params so raycast == visuals ----
function paramsFor(mode, T) {
  const B = config.beam || {};
  if (mode === "laser") {
    const b = B.laser || {};
    return {
      steps: b.steps ?? 24,
      step:  (b.stepTiles ?? 3) * T,
      radius:(b.radiusTiles ?? 6) * T,
      thickness: (b.thicknessTiles ?? 0.5) * T
    };
  }
  if (mode === "cone") {
    const b = B.cone || {};
    return {
      steps: b.steps ?? 10,
      step:  (b.stepTiles ?? 3) * T,
      radius:(b.radiusTiles ?? 10) * T,   // used as half-width at far end
    };
  }
  if (mode === "bubble") {
    const b = B.bubble || {};
    return { radius: (b.radiusTiles ?? 14) * T };
  }
  return {};
}

// ---- Live‑tunable beam params (pixels, world space) ----
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
  let clearedFog = 0;

  if (mode === "laser") {
    const STEPS = 24;
    const step = BeamParams.laserLength / STEPS;
    const r = Math.max(2, BeamParams.laserThickness * 0.5);
    for (let i = 1; i <= STEPS; i++) {
      const wx = origin.x + Math.cos(dir) * i * step;
      const wy = origin.y + Math.sin(dir) * i * step;
      clearedFog += miasma.clearArea(wx, wy, r, MAX_PER_STEP);
    }
    return { hits: [], clearedFog };
  }

  if (mode === "cone") {
    const STEPS = 14;
    const step = BeamParams.coneLength / STEPS;
    const halfA = (BeamParams.coneHalfAngleDeg * Math.PI) / 180;
    for (let i = 1; i <= STEPS; i++) {
      const d = i * step;
      const wx = origin.x + Math.cos(dir) * d;
      const wy = origin.y + Math.sin(dir) * d;
      const halfWidth = Math.tan(halfA) * d; // literal 128° wedge
      const rr = Math.max(6, halfWidth);     // small floor to avoid gaps near apex
      clearedFog += miasma.clearArea(wx, wy, rr, MAX_PER_STEP);
    }
    return { hits: [], clearedFog };
  }

  if (mode === "bubble") {
    clearedFog += miasma.clearArea(
      origin.x, origin.y, BeamParams.bubbleRadius, Math.max(900, MAX_PER_STEP)
    );
    return { hits: [], clearedFog };
  }

  return { hits: [], clearedFog };
}




export function draw(ctx, cam, player) {
  const mode = MODES[state.modeIndex];
  if (mode === "off") return;

  // Unified light color (same hue; opacity varies by focus)
  const LIGHT_RGB = "255,240,0";

  ctx.save();
  ctx.translate(-cam.x + player.x, -cam.y + player.y);
  ctx.rotate(state.angle);

  const prevComp = ctx.globalCompositeOperation;
  const prevAlpha = ctx.globalAlpha;
  ctx.globalCompositeOperation = "lighter";

  if (mode === "bubble") {
    // Visuals: bubbleRadius → diameter live from params
    const r = BeamParams.bubbleRadius;
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);

    // same color, low opacity center fading to 0
    g.addColorStop(0.0, `rgba(${LIGHT_RGB},0.30)`);
    g.addColorStop(1.0, `rgba(${LIGHT_RGB},0.00)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

  } else if (mode === "laser") {
    // Visuals: use live params
    const len = BeamParams.laserLength;
    const thick = BeamParams.laserThickness;


    // Single hue; layered opacity for glow while staying “one color”
    ctx.lineCap = "round";

    // outer soft aura
    ctx.strokeStyle = `rgba(${LIGHT_RGB},0.25)`;
    ctx.lineWidth = thick * 2.25;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(len, 0); ctx.stroke();

    // mid body
    ctx.strokeStyle = `rgba(${LIGHT_RGB},0.6)`;
    ctx.lineWidth = thick * 1.25;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(len, 0); ctx.stroke();

    // core
    ctx.strokeStyle = `rgba(${LIGHT_RGB},1.0)`;
    ctx.lineWidth = thick;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(len, 0); ctx.stroke();

    // tip bloom (same hue)
    const tipR = Math.max(thick * 1.6, 6);
    const tip = ctx.createRadialGradient(len, 0, 0, len, 0, tipR * 2);
    tip.addColorStop(0, `rgba(${LIGHT_RGB},0.9)`);
    tip.addColorStop(1, `rgba(${LIGHT_RGB},0.0)`);
    ctx.fillStyle = tip;
    ctx.beginPath(); ctx.arc(len, 0, tipR * 2, 0, Math.PI * 2); ctx.fill();

  } else {
    // CONE: literal 128° wedge (live angle/length)
    const length = BeamParams.coneLength;
    const halfAngle = (BeamParams.coneHalfAngleDeg * Math.PI) / 180;

    const farHalfWidth = Math.tan(halfAngle) * length; // ~459px

    // Fill wedge with one hue, opacity strongest along center, fading to edges
    // Approach: base fill low alpha + central spine stroke higher alpha.
    // Base wedge
    ctx.fillStyle = `rgba(${LIGHT_RGB},0.35)`;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(length, -farHalfWidth);
    ctx.lineTo(length,  farHalfWidth);
    ctx.closePath();
    ctx.fill();

    // Add a gentle length fade (overlay gradient along +X)
    const lg = ctx.createLinearGradient(0, 0, length, 0);
    lg.addColorStop(0.0, `rgba(${LIGHT_RGB},0.25)`);
    lg.addColorStop(0.7, `rgba(${LIGHT_RGB},0.18)`);
    lg.addColorStop(1.0, `rgba(${LIGHT_RGB},0.0)`);
    ctx.fillStyle = lg;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(length, -farHalfWidth);
    ctx.lineTo(length,  farHalfWidth);
    ctx.closePath();
    ctx.fill();

    // Central spine to imply focus (same hue, higher opacity)
    ctx.strokeStyle = `rgba(${LIGHT_RGB},0.6)`;
    ctx.lineWidth = 10; // px spine thickness near center
    ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(length, 0); ctx.stroke();
  }

  ctx.globalCompositeOperation = prevComp;
  ctx.globalAlpha = prevAlpha;
  ctx.restore();
}
