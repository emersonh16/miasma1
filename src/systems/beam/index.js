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
      const t = i / P.steps;
      const wx = origin.x + Math.cos(dir) * i * P.step;
      const wy = origin.y + Math.sin(dir) * i * P.step;
      const rr = Math.max(1, P.radius * t);
      clearedFog += miasma.clearArea(wx, wy, rr, 999);
    }
    const tipX = origin.x + Math.cos(dir) * (P.steps * P.step);
    const tipY = origin.y + Math.sin(dir) * (P.steps * P.step);
    clearedFog += miasma.clearArea(tipX, tipY, P.radius, 999);
  } else if (mode === "bubble") {
    clearedFog += miasma.clearArea(origin.x, origin.y, P.radius, 999);
  }
  return { hits: [], clearedFog };
}

export function draw(ctx, cam, player) {
  const mode = MODES[state.modeIndex];
  if (mode === "off") return;

  const T = FOG_T();
  const P = paramsFor(mode, T);

  // Base gold palette
  const core = "rgba(255,240,0,1.0)";   // bright core
  const mid  = "rgba(255,223,0,1.0)";   // mid mustard
  const outer= "rgba(255,215,0,1.0)";   // outer mustard

  ctx.save();
  ctx.translate(-cam.x + player.x, -cam.y + player.y);
  ctx.rotate(state.angle);

  const prevComp = ctx.globalCompositeOperation;
  const prevAlpha = ctx.globalAlpha;
  ctx.globalCompositeOperation = "lighter";

  if (mode === "bubble") {
    // Lantern-like glow bubble (no rim)
    const r = P.radius;
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0.0, core);
    g.addColorStop(0.4, "rgba(255,223,0,0.35)");
    g.addColorStop(1.0, "rgba(255,215,0,0.0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
  } else if (mode === "laser") {
    const len = P.steps * P.step;

    // Solid opaque mustard-gold beam
    ctx.strokeStyle = outer;
    ctx.lineWidth = P.thickness * 6;
    ctx.lineCap = "round";
    ctx.globalAlpha = 1.0;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(len, 0); ctx.stroke();

    ctx.strokeStyle = mid;
    ctx.lineWidth = P.thickness * 3;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(len, 0); ctx.stroke();

    ctx.strokeStyle = core;
    ctx.lineWidth = P.thickness;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(len, 0); ctx.stroke();

    // Tip flare
    const tipR = Math.max(P.thickness * 2, T * 0.75);
    const tip = ctx.createRadialGradient(len, 0, 0, len, 0, tipR * 2);
    tip.addColorStop(0, "rgba(255,245,200,1.0)");
    tip.addColorStop(1, "rgba(255,200,80,0.0)");
    ctx.fillStyle = tip;
    ctx.beginPath(); ctx.arc(len, 0, tipR * 2, 0, Math.PI * 2); ctx.fill();
  } else {
    // CONE: translucent gradient wedge, base as wide as player
    const len = P.steps * P.step;
    const half = P.radius;
    const baseHalf = 2 * T; // ~player body width; replace with player.width/2 if available

    const grad = ctx.createLinearGradient(0, 0, len, 0);
    grad.addColorStop(0.0, "rgba(255,215,0,0.6)");
    grad.addColorStop(0.6, "rgba(255,215,0,0.3)");
    grad.addColorStop(1.0, "rgba(255,215,0,0.0)");
    ctx.fillStyle = grad;

    ctx.beginPath();
    ctx.moveTo(-baseHalf, 0);
    ctx.lineTo(baseHalf, 0);
    ctx.lineTo(len, -half);
    ctx.lineTo(len,  half);
    ctx.closePath();
    ctx.fill();
  }

  ctx.globalCompositeOperation = prevComp;
  ctx.globalAlpha = prevAlpha;
  ctx.restore();
}
