import * as miasma from "../miasma/index.js";
const FOG_T = () => miasma.getTileSize(); // world units per fog tile


// Modes are ordered low→high: laser → cone → bubble → off (no-beam)
const MODES = ["laser", "cone", "bubble", "off"];
const state = {
  modeIndex: 1,   // start at "cone"
  angle: 0        // radians, world-relative aim
};

export function getMode() { return MODES[state.modeIndex]; }

export function setMode(m) {
  const i = MODES.indexOf((m || "").toLowerCase());
  if (i !== -1) state.modeIndex = i;
}

export function modeUp(steps = 1) { // toward "off"
  state.modeIndex = Math.min(MODES.length - 1, state.modeIndex + steps);
}
export function modeDown(steps = 1) { // toward "laser"
  state.modeIndex = Math.max(0, state.modeIndex - steps);
}

export function setAngle(rad) { state.angle = rad || 0; }



export function raycast(origin, dir, params = {}) {
  const { mode = MODES[state.modeIndex] } = params;
  const T = FOG_T();
  let clearedFog = 0;

  if (mode === "laser") {
    const steps = 24;
    const stepSize = 3 * T;
    const radius = 6 * T;
    for (let i = 1; i <= steps; i++) {
      const wx = origin.x + Math.cos(dir) * i * stepSize;
      const wy = origin.y + Math.sin(dir) * i * stepSize;
      clearedFog += miasma.clearArea(wx, wy, radius, 999);
    }
  } else if (mode === "cone") {
    // Sweep along a center ray; each sample clears a circle of `radius`.
    const steps = 10;
    const stepSize = 3 * T;
    const radius = 10 * T;
    for (let i = 1; i <= steps; i++) {
      const wx = origin.x + Math.cos(dir) * i * stepSize;
      const wy = origin.y + Math.sin(dir) * i * stepSize;
      clearedFog += miasma.clearArea(wx, wy, radius, 999);
    }
  } else if (mode === "bubble") {
    const radius = 14 * T;
    clearedFog += miasma.clearArea(origin.x, origin.y, radius, 999);
  }

  return { hits: [], clearedFog };
}





export function draw(ctx, cam, player) {
  const mode = MODES[state.modeIndex];
  if (mode === "off") return;

  const T = FOG_T();

  // Must match raycast geometry
  const LASER_STEPS = 24;
  const LASER_STEP  = 3 * T;
  const LASER_LEN   = LASER_STEPS * LASER_STEP; // same as raycast
  const LASER_THICK = 0.5 * T;

  const CONE_STEPS  = 10;
  const CONE_STEP   = 3 * T;
  const CONE_LEN    = CONE_STEPS * CONE_STEP;   // far edge of cone
  const CONE_RADIUS = 10 * T;                   // far-half-width; matches clearArea radius

  const BUBBLE_R    = 14 * T;                   // same as clearArea radius

  ctx.save();
  ctx.translate(-cam.x + player.x, -cam.y + player.y);
  ctx.rotate(state.angle);
  ctx.globalAlpha = 0.85;

  if (mode === "bubble") {
    ctx.beginPath();
    ctx.arc(0, 0, BUBBLE_R, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,240,160,0.25)";
    ctx.fill();
  } else if (mode === "laser") {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(LASER_LEN, 0);
    ctx.lineWidth = LASER_THICK;
    ctx.strokeStyle = "rgba(255,240,160,0.9)";
    ctx.stroke();
  } else {
    // Cone: triangle opening to width 2*CONE_RADIUS at distance CONE_LEN
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(CONE_LEN, -CONE_RADIUS);
    ctx.lineTo(CONE_LEN,  CONE_RADIUS);
    ctx.closePath();
    ctx.fillStyle = "rgba(255,240,160,0.35)";
    ctx.fill();
  }

  ctx.restore();
}

export function getAngle() { return state.angle; }

