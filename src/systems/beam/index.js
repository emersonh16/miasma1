import * as miasma from "../miasma/index.js";
import { config } from "../../core/config.js";
import { iterEntitiesInAABB } from "../../world/store.js";


// world units per fog tile
const FOG_T = () => miasma.getTileSize();

const MODES = ["laser", "cone", "bubble", "off"];



export function getMode() { return MODES[state.modeIndex]; }
export function setMode(m) {
  const i = MODES.indexOf((m || "").toLowerCase());
  if (i !== -1) state.modeIndex = i;
}
export function modeUp(steps = 1)   { state.modeIndex = Math.min(MODES.length - 1, state.modeIndex + steps); }
export function modeDown(steps = 1) { state.modeIndex = Math.max(0, state.modeIndex - steps); }
export function setAngle(rad) { state.angle = rad || 0; }
export function getAngle()   { return state.angle; }

// --- new family toggle ---
export function toggleFamily() {
  state.family = (state.family === "discrete") ? "continuous" : "discrete";
}
export function getFamily() { return state.family; }

// ---- Live-tunable beam params (pixels in world space) ----
const CONE_TOTAL_MIN = 4;
const CONE_TOTAL_MAX = 64;
const CONE_HALF_MIN  = CONE_TOTAL_MIN * 0.5;
const CONE_HALF_MAX  = CONE_TOTAL_MAX * 0.5;


const BeamParams = {
  // Bubble band
  bubbleRadius: 72,        // MAX bubble
  minBubbleRadius: 28,     // ↑ from ~16–20 → slightly larger “MIN bubble”

  // Cone band
  coneLength: 256,         // reach
  coneHalfAngleDeg: 26,    // tighter angle
  coneBaseRadius: 80,      // new: circle base just larger than max bubble

  // Laser band
  laserLength: 480,        // longer than cone (256)
  laserThickness: 16,      // much thicker core hitbox + visual


  // Perf
  budgetPerStamp: 160,
};



// 5 continuous states: 0=OFF, 1=MIN BUBBLE, 2=MAX BUBBLE, 3=CONE, 4=LASER
const state = { modeIndex: 1, angle: 0, family: "continuous", levelIndex: 0 };

// --- Smooth display index (float) that eases toward levelIndex ---
let _smoothIdx = 0;                 // float 0..4
let _lastSmoothMs = performance.now();
const SMOOTH_HZ = 16;

// Exponential ease toward the integer levelIndex; returns float 0..4
function _advanceSmooth() {
  const now = performance.now();
  const dt = Math.max(0, (now - _lastSmoothMs) / 1000);
  _lastSmoothMs = now;
  const target = state.levelIndex | 0;
  const k = 1 - Math.exp(-SMOOTH_HZ * dt); // 0..1
  _smoothIdx = _smoothIdx + (target - _smoothIdx) * k;
  return _smoothIdx;
}

export function getLevelIndex() { return state.levelIndex | 0; }          // int 0..4
export function setLevelIndex(i) { state.levelIndex = Math.max(0, Math.min(4, (i|0))); }

export function getLevel() {
  // normalized (0..1) if a UI wants it (0..4 mapped to 0..1)
  return (state.levelIndex | 0) / 4;
}



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

function clearLaser(origin, dir, length, thickness, budget) {
  const T = miasma.getTileSize();
  let cleared = 0;
  const ux = Math.cos(dir), uy = Math.sin(dir);
  for (let d = T; d <= length; d += T) {
    const wx = origin.x + ux * d;
    const wy = origin.y + uy * d;
    cleared += miasma.clearArea(wx, wy, thickness, budget);
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

function sampleContinuousEnvelope(origin, dir) {
  const T = miasma.getTileSize();
  const ux = Math.cos(dir), uy = Math.sin(dir);
  const circles = [];

  // float 0..4 easing toward the integer level
  const idxF = _advanceSmooth();

  // 0 = OFF
  if (idxF <= 0.001) return circles;

    // 1 = MIN BUBBLE (fixed tight radius, snapped to tile scale)
  if (idxF <= 1.0) {
    const rMin = BeamParams.minBubbleRadius;
    circles.push({ x: origin.x, y: origin.y, r: rMin });
    return circles;
  }



  // 1→2 : interpolate MIN→MAX BUBBLE
  if (idxF <= 2.0) {
    const t = idxF - 1.0; // 0..1
    const rMin = 16, rMax = BeamParams.bubbleRadius;
    const r = rMin + (rMax - rMin) * t;
    circles.push({ x: origin.x, y: origin.y, r });
    return circles;
  }

  // 2→3 : MAX BUBBLE → CONE (shrink bubble while growing a wide cone)
  if (idxF <= 3.0) {
    const t = idxF - 2.0; // 0..1
    const rBubble = BeamParams.bubbleRadius * (1.0 - t);
    const baseR   = BeamParams.coneBaseRadius;
    if (rBubble > 2) circles.push({ x: origin.x, y: origin.y, r: rBubble });
    else circles.push({ x: origin.x, y: origin.y, r: baseR }); // ensure cone base circle stays > max bubble


    const halfAdeg = 32; // wide-cone target
    const halfA = (halfAdeg * Math.PI) / 180;
    const len  = Math.max(T, BeamParams.coneLength * t);
    const step = Math.max(T * 1.0, 6);
    for (let d = step; d <= len; d += step) {
      const cx = origin.x + ux * d;
      const cy = origin.y + uy * d;
      const rr = Math.max(2, Math.tan(halfA) * d);
      circles.push({ x: cx, y: cy, r: rr });
    }
    return circles;
  }

  // 3→4 : CONE → LASER (narrow the cone down)
  {
    const t = idxF - 3.0; // 0..1
    const halfAdeg0 = 32, halfAdeg1 = 0.5;
    const halfAdeg  = halfAdeg0 + (halfAdeg1 - halfAdeg0) * t;
    const halfA     = (halfAdeg * Math.PI) / 180;

    const len  = BeamParams.coneLength;
    const step = Math.max(T * 1.0, 6);
    for (let d = step; d <= len; d += step) {
      const cx = origin.x + ux * d;
      const cy = origin.y + uy * d;
      const rr = Math.max(2, Math.tan(halfA) * d);
      circles.push({ x: cx, y: cy, r: rr });
    }
    return circles;
  }
}






// ---- hit test & clearing (hitbox matches visuals) ----
export function raycast(origin, dir, params = {}) {
  const mode = params.mode || MODES[state.modeIndex];
  const MAX_PER_STEP = BeamParams.budgetPerStamp;
  const T = miasma.getTileSize();
  const TILE_PAD = T * 0.15;
  let clearedFog = 0;
  BeamStats.stamps = 0;
  BeamStats.clearedTiles = 0;


  // continuous family → use shared sampler (0..16 levels) in WORLD space
  if (state.family === "continuous") {
    const circles = sampleContinuousEnvelope(origin, dir);
    for (const c of circles) {
      const n = miasma.clearArea(c.x, c.y, c.r, BeamParams.budgetPerStamp);
      clearedFog += n; BeamStats.clearedTiles += n; BeamStats.stamps++;
    }
    return { hits: [], clearedFog };
  }




  // Laser: clears fog AND damages enemies along the beam over time
  if (mode === "laser") {
    // --- visual/clear pass (unchanged) ---
   // --- DAMAGE pass (laser only) --- (context above)
const Tz = miasma.getTileSize();
const MIN_JUMP_PX = Math.max(12, Tz * 2);
// Use dedicated laser length; still ensure it's not absurdly short
const len = Math.max(BeamParams.laserLength, BeamParams.coneLength + MIN_JUMP_PX, 64);


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
    // Tunable via config.beam.laser.dps (fallback 15)
    const LASER_DPS = (config?.beam?.laser?.dps ?? 15);
    // Keep API stable: derive dt internally
    const now = performance.now();
    if (typeof raycast._lastTime !== "number") raycast._lastTime = now;
    const dt = Math.min(0.05, Math.max(0, (now - raycast._lastTime) / 1000));
    raycast._lastTime = now;

    // Build an AABB around the beam to cheaply gather candidates
    const x0 = origin.x, y0 = origin.y;
    const x1 = origin.x + ux * len, y1 = origin.y + uy * len;
    const pad = offHalo2 + T * 1.5; // generous enough to include core/halos
    const minX = Math.min(x0, x1) - pad, maxX = Math.max(x0, x1) + pad;
    const minY = Math.min(y0, y1) - pad, maxY = Math.max(y0, y1) + pad;

    // Precise cylinder hit vs enemies within the AABB
    for (const e of iterEntitiesInAABB(minX, minY, maxX, maxY)) { // uses world/store iterator:contentReference[oaicite:0]{index=0}
      if (e?.type !== "enemy" || typeof e.health !== "number") continue;
      // Project enemy onto beam segment
      const vx = e.x - x0, vy = e.y - y0;
      const tProj = vx * ux + vy * uy;         // distance along beam
      if (tProj < 0 || tProj > len) continue;  // outside segment
      // Perp distance to beam centerline — expand by enemy radius so it "feels" like the visual
      const perp = Math.abs(vx * uy - vy * ux);
      const er = (e.r ?? 0);
      if (perp <= rCore + er) {
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
        {
        const n = miasma.clearArea(cx, cy, r, budget);
        clearedFog += n; BeamStats.clearedTiles += n; BeamStats.stamps++;
      }

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

  if (mode === "bubble") {
    const r = BeamParams.bubbleRadius + TILE_PAD;
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

  // continuous family → draw EXACTLY the sampled circles (opaque) to match hitbox
  if (state.family === "continuous") {
    // We already translated to player and rotated by state.angle.
    // So sample in local space at origin with dir=0 to avoid double-rotating.
    const localCircles = sampleContinuousEnvelope({ x: 0, y: 0 }, 0);


    for (const c of localCircles) {
      const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, c.r);
      g.addColorStop(0.0, `rgba(${LIGHT_RGB},0.35)`);
      g.addColorStop(1.0, `rgba(${LIGHT_RGB},0.0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
      ctx.fill();
    }


    ctx.globalCompositeOperation = prevComp;
    ctx.globalAlpha = prevAlpha;
    ctx.restore();
    return;
  }



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
  const Tz = miasma.getTileSize();
  const MIN_JUMP_PX = Math.max(12, Tz * 2);
  // Draw length matches hitbox length
  const len = Math.max(BeamParams.laserLength, BeamParams.coneLength + MIN_JUMP_PX, 64);
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
