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

export function draw(ctx, cam, player) {
  const mode = MODES[state.modeIndex];
  if (mode === "off") return;

  const T = FOG_T();
  const P = (function params() {
    // match raycast geometry via config (same as raycast uses)
    const B = (config.beam || {});
    if (mode === "laser") {
      const b = B.laser || {};
      return { steps: b.steps ?? 24, step: (b.stepTiles ?? 3) * T, radius: (b.radiusTiles ?? 6) * T, thickness: Math.max(1, (b.thicknessTiles ?? 0.5) * T) };
    }
    if (mode === "cone") {
      const b = B.cone || {};
      return { steps: b.steps ?? 10, step: (b.stepTiles ?? 3) * T, radius: (b.radiusTiles ?? 10) * T };
    }
    if (mode === "bubble") {
      const b = B.bubble || {};
      return { radius: (b.radiusTiles ?? 14) * T };
    }
    return {};
  })();

  // Golden glow palette
  const core = "rgba(255, 245, 200, 0.95)";
  const mid  = "rgba(255, 215, 120, 0.55)";
  const outer= "rgba(255, 185, 60,  0.25)";

  ctx.save();
  ctx.translate(-cam.x + player.x, -cam.y + player.y);
  ctx.rotate(state.angle);

  // Additive glow for “light” feeling
  const prevComp = ctx.globalCompositeOperation;
  const prevAlpha = ctx.globalAlpha;
  ctx.globalCompositeOperation = "lighter";

  if (mode === "bubble") {
    // Soft radial glow bubble
    const r = P.radius;
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0.0, core);
    g.addColorStop(0.5, mid);
    g.addColorStop(1.0, "rgba(255,185,60,0.0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    // subtle rim
    ctx.strokeStyle = "rgba(255,230,160,0.35)";
    ctx.lineWidth = Math.max(1, r * 0.03);
    ctx.stroke();
  } else if (mode === "laser") {
    const len = P.steps * P.step;

    // Outer bloom
    ctx.strokeStyle = outer;
    ctx.lineWidth = P.thickness * 6;
    ctx.lineCap = "round";
    ctx.globalAlpha = 0.5;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(len, 0); ctx.stroke();

    // Mid glow
    ctx.strokeStyle = mid;
    ctx.lineWidth = P.thickness * 3;
    ctx.globalAlpha = 0.8;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(len, 0); ctx.stroke();

    // Core beam
    ctx.strokeStyle = core;
    ctx.lineWidth = P.thickness;
    ctx.globalAlpha = 1.0;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(len, 0); ctx.stroke();

    // Warm tip flare
    const tipR = Math.max(P.thickness * 2, T * 0.75);
    const tip = ctx.createRadialGradient(len, 0, 0, len, 0, tipR * 2);
    tip.addColorStop(0, "rgba(255,255,220,0.9)");
    tip.addColorStop(1, "rgba(255,200,80,0.0)");
    ctx.fillStyle = tip;
    ctx.beginPath(); ctx.arc(len, 0, tipR * 2, 0, Math.PI * 2); ctx.fill();
  } else {
    // CONE: soft-edged triangle using two passes (bloom + core)
    const len = P.steps * P.step;
    const half = P.radius;

    // Outer soft cone
    const grad = ctx.createLinearGradient(0, 0, len, 0);
    grad.addColorStop(0.00, "rgba(255,200,80,0.15)");
    grad.addColorStop(0.35, "rgba(255,210,120,0.25)");
    grad.addColorStop(1.00, "rgba(255,200,80,0.0)");
    ctx.fillStyle = grad;
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(len, -half);
    ctx.lineTo(len,  half);
    ctx.closePath();
    ctx.fill();

    // Core cone
    const inner = Math.max(half * 0.55, T * 1.0);
    const g2 = ctx.createLinearGradient(0, 0, len, 0);
    g2.addColorStop(0.00, "rgba(255,245,200,0.7)");
    g2.addColorStop(0.60, "rgba(255,230,150,0.55)");
    g2.addColorStop(1.00, "rgba(255,210,120,0.00)");
    ctx.fillStyle = g2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(len, -inner);
    ctx.lineTo(len,  inner);
    ctx.closePath();
    ctx.fill();
  }

  // restore state
  ctx.globalCompositeOperation = prevComp;
  ctx.globalAlpha = prevAlpha;
  ctx.restore();
}

