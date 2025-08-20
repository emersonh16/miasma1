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
      radius:(b.radiusTiles ?? 10) * T,   // used as half‑width at far end
    };
  }
  if (mode === "bubble") {
    const b = B.bubble || {};
    return { radius: (b.radiusTiles ?? 14) * T };
  }
  return {};
}

// ---- hit test & clearing ----
export function raycast(origin, dir, params = {}) {
  const mode = params.mode || MODES[state.modeIndex];
  const T = FOG_T();
  const P = paramsFor(mode, T);
  let clearedFog = 0;

  if (mode === "laser") {
    for (let i = 1; i <= P.steps; i++) {
      const wx = origin.x + Math.cos(dir) * i * P.step;
      const wy = origin.y + Math.sin(dir) * i * P.step;
      clearedFog += miasma.clearArea(wx, wy, P.radius, 999);
    }
  } else if (mode === "cone") {
    for (let i = 1; i <= P.steps; i++) {
      const wx = origin.x + Math.cos(dir) * i * P.step;
      const wy = origin.y + Math.sin(dir) * i * P.step;
      clearedFog += miasma.clearArea(wx, wy, P.radius, 999);
    }
  } else if (mode === "bubble") {
    clearedFog += miasma.clearArea(origin.x, origin.y, P.radius, 999);
  }
  return { hits: [], clearedFog };
}

// ---- visuals derived from the same params ----
export function draw(ctx, cam, player) {
  const mode = MODES[state.modeIndex];
  if (mode === "off") return;

  const T = FOG_T();
  const P = paramsFor(mode, T);

  ctx.save();
  ctx.translate(-cam.x + player.x, -cam.y + player.y);
  ctx.rotate(state.angle);
  ctx.globalAlpha = 0.85;

  if (mode === "bubble") {
    ctx.beginPath();
    ctx.arc(0, 0, P.radius, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,240,160,0.25)";
    ctx.fill();
  } else if (mode === "laser") {
    const len = P.steps * P.step;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(len, 0);
    ctx.lineWidth = Math.max(1, P.thickness);
    ctx.strokeStyle = "rgba(255,240,160,0.9)";
    ctx.stroke();
  } else {
    // cone triangle: width = 2*radius at far end, length = steps*step
    const len = P.steps * P.step;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(len, -P.radius);
    ctx.lineTo(len,  P.radius);
    ctx.closePath();
    ctx.fillStyle = "rgba(255,240,160,0.35)";
    ctx.fill();
  }

  ctx.restore();
}
