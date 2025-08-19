import * as miasma from "../miasma/index.js";

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
  let clearedFog = 0;

  if (mode === "laser") {
    // narrow line of small clears
    const steps = 12;
    const stepSize = 16;
    for (let i = 1; i <= steps; i++) {
      const wx = origin.x + Math.cos(dir) * i * stepSize;
      const wy = origin.y + Math.sin(dir) * i * stepSize;
      clearedFog += miasma.clearArea(wx, wy, 24, 80);
    }
  } else if (mode === "cone") {
    // short forward cone
    const steps = 6;
    const stepSize = 32;
    for (let i = 1; i <= steps; i++) {
      const wx = origin.x + Math.cos(dir) * i * stepSize;
      const wy = origin.y + Math.sin(dir) * i * stepSize;
      clearedFog += miasma.clearArea(wx, wy, 64, 64);
    }
  } else if (mode === "bubble") {
    // around the player
    clearedFog += miasma.clearArea(origin.x, origin.y, 90, 90);
  }

  return { hits: [], clearedFog };
}


export function draw(ctx, cam, player) {
  const mode = MODES[state.modeIndex];
  if (mode === "off") return; // no-beam: draw nothing

  ctx.save();
  ctx.translate(-cam.x + player.x, -cam.y + player.y);
  ctx.rotate(state.angle);
  ctx.globalAlpha = 0.85;

  if (mode === "bubble") {
    ctx.beginPath();
    ctx.arc(0, 0, 90, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,240,160,0.25)";
    ctx.fill();
  } else if (mode === "laser") {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(180, 0);
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(255,240,160,0.9)";
    ctx.stroke();
  } else {
    // cone
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(140, -22);
    ctx.lineTo(140, 22);
    ctx.closePath();
    ctx.fillStyle = "rgba(255,240,160,0.35)";
    ctx.fill();
  }

  ctx.restore();
}

export function getAngle() { return state.angle; }

