import { config } from "../core/config.js";
import { worldToTile } from "../core/coords.js";
import * as beam from "../systems/beam/index.js";

let fps = 0, last = performance.now(), frames = 0;

// --- UI geometry/state ---
const COMPASS_R = 44;
const PANEL_W = 170;
const PANEL_H = 170;
const SLIDER_W = 120;
const SLIDER_H = 10;
const SPEED_MIN = 0;
const SPEED_MAX = 120;
const SPEED_STEPS = 100;
const SMOOTH = 0.18;


// positions
const geom = {
  panel:  { x: 0, y: 0, w: PANEL_W, h: PANEL_H + 108 },
  compass:{ cx: 0, cy: 0, r: COMPASS_R },
  slider: { x: 0, y: 0, w: SLIDER_W, h: SLIDER_H },

  // miasma toggle
  bMiasma:    { x: 0, y: 0, w: 120, h: 18 },

  // beam level buttons
  bBeamMinus: { x: 0, y: 0, w: 24, h: 18 },
  bBeamPlus:  { x: 0, y: 0, w: 24, h: 18 },

};

// interaction + UI-smoothing state
let draggingDir = false;
let draggingSpeed = false;

let mouseDown = false;
let windModule = null;
let dispDeg = 0;
let dispSpeed = 0;
let uiInited = false;

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
function norm360(deg) { deg %= 360; return deg < 0 ? deg + 360 : deg; }
function shortestArcLerpDeg(a, b, t) {
  let d = ((b - a + 540) % 360) - 180;
  return a + d * t;
}
function pointInCircle(mx, my, c) { const dx = mx - c.cx, dy = my - c.cy; return dx*dx + dy*dy <= c.r*c.r; }
function pointInRect(mx, my, r) { return mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h; }

function setWind(patch) { if (!windModule) return; windModule.setGear(0, { ...patch, locked: true }); }

// --- Input (HUD-only) ---
addEventListener("mousedown", (e) => {
  if (!config.flags.devhud) return;

  mouseDown = true;
  const mx = e.clientX, my = e.clientY;

  // Wind controls
  if (pointInCircle(mx, my, geom.compass)) { draggingDir = true; updateDirFromMouse(mx, my); return; }
  if (pointInRect(mx, my, geom.slider))    { draggingSpeed = true; updateSpeedFromMouse(mx);  return; }

  // Beam level buttons
  if (pointInRect(mx, my, geom.bBeamMinus)) { beam.levelDown(); return; }
  if (pointInRect(mx, my, geom.bBeamPlus))  { beam.levelUp();   return; }

  // Miasma toggle button
  if (pointInRect(mx, my, geom.bMiasma)) { config.flags.miasma = !config.flags.miasma; return; }
});
addEventListener("mousemove", (e) => {
  if (!mouseDown || !config.flags.devhud) return;
  const mx = e.clientX, my = e.clientY;
  if (draggingDir)   { updateDirFromMouse(mx, my); return; }
  if (draggingSpeed) { updateSpeedFromMouse(mx);   return; }
});
function endDrag() { mouseDown = false; draggingDir = false; draggingSpeed = false; }
addEventListener("mouseup", endDrag);
addEventListener("mouseleave", endDrag);
addEventListener("blur", endDrag);

function updateDirFromMouse(mx, my) {
  const dx = mx - geom.compass.cx;
  const dy = my - geom.compass.cy;
  const angleDeg = norm360((Math.atan2(dy, dx) * 180) / Math.PI);
  setWind({ dirDeg: angleDeg });
}
function updateSpeedFromMouse(mx) {
  const t = clamp((mx - geom.slider.x) / geom.slider.w, 0, 1);
  const q = Math.round(t * SPEED_STEPS) / SPEED_STEPS;
  const spd = SPEED_MIN + q * (SPEED_MAX - SPEED_MIN);
  setWind({ speedTilesPerSec: spd });
}

/** Dev HUD overlay */
export function drawDevHUD(ctx, cam, player, mouse, miasma, wind, w, h) {
  if (!config.flags.devhud) return;
  if (!windModule) windModule = wind;

  // FPS
  frames++; const now = performance.now();
  if (now - last >= 1000) { fps = frames; frames = 0; last = now; }

  // Layout (top-right)
  const pad = 10;
  geom.panel.x = w - PANEL_W - pad;
  geom.panel.y = pad;

  // compass + wind row
  geom.compass.cx = geom.panel.x + 60;
  geom.compass.cy = geom.panel.y + 50;
  geom.slider.x   = geom.panel.x + 30;
  geom.slider.y   = geom.compass.cy + 60;

  ctx.save();
  ctx.font = "12px monospace";
  ctx.textBaseline = "top";

  // Panel
  const panelBottom = h - 20;
  const panelHeight = panelBottom - geom.panel.y;
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(geom.panel.x, geom.panel.y, geom.panel.w, panelHeight);
  ctx.strokeStyle = "rgba(255,255,255,0.2)";
  ctx.strokeRect(geom.panel.x + 0.5, geom.panel.y + 0.5, geom.panel.w - 1, geom.panel.h - 1);

  // Header
  ctx.fillStyle = "#fff";
  ctx.fillText(`FPS: ${fps}`, geom.panel.x + 8, geom.panel.y + 6);

  // Wind readout
  const wv = wind.getVelocity({
    centerWX: cam.x, centerWY: cam.y,
    tileSize: miasma.getTileSize(), time: now / 1000
  });
  const rawSpeed = Math.hypot(wv.vxTilesPerSec, wv.vyTilesPerSec);
  const rawDegUp = norm360((Math.atan2(wv.vyTilesPerSec, wv.vxTilesPerSec) * 180) / Math.PI);
  const targetDegDown = norm360(rawDegUp + 180);
  if (!uiInited) { dispSpeed = rawSpeed; dispDeg = targetDegDown; uiInited = true; }
  else { dispSpeed += (rawSpeed - dispSpeed) * SMOOTH; dispDeg = shortestArcLerpDeg(dispDeg, targetDegDown, SMOOTH); }

  ctx.fillText(`Wind: ${dispSpeed.toFixed(1)} t/s @ ${Math.round(dispDeg)}° (downwind)`, geom.panel.x + 8, geom.panel.y + 22);

  // Compass
  ctx.save();
  ctx.translate(geom.compass.cx, geom.compass.cy);
  ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(0, 0, geom.compass.r, 0, Math.PI * 2); ctx.stroke();
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6;
    const x = Math.cos(a) * (geom.compass.r - 3);
    const y = Math.sin(a) * (geom.compass.r - 3);
    const ix = Math.cos(a) * (geom.compass.r - 8);
    const iy = Math.sin(a) * (geom.compass.r - 8);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ix, iy); ctx.stroke();
  }
  ctx.rotate((dispDeg * Math.PI) / 180);
  ctx.fillStyle = "#ffd700";
  ctx.beginPath(); ctx.moveTo(geom.compass.r - 4, 0); ctx.lineTo(-10, -4); ctx.lineTo(-10, 4); ctx.closePath(); ctx.fill();
  ctx.restore();

  // Speed slider
  ctx.fillStyle = "#ccc"; ctx.fillText("Speed", geom.slider.x, geom.slider.y - 14);
  ctx.fillStyle = "rgba(255,255,255,0.2)";
  ctx.fillRect(geom.slider.x, geom.slider.y, geom.slider.w, geom.slider.h);
  {
    const t = clamp((dispSpeed - SPEED_MIN) / (SPEED_MAX - SPEED_MIN), 0, 1);
    const knobX = Math.round(geom.slider.x + t * geom.slider.w);
    const knobY = geom.slider.y + geom.slider.h / 2;
    ctx.fillStyle = "#ffd700";
    ctx.beginPath(); ctx.arc(knobX, knobY, 6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.7)"; ctx.stroke();
  }

  // --- Beam level control ---
  const level = (typeof beam.getLevel === "function") ? beam.getLevel() : 1;
  const x0 = geom.panel.x + 30;
  const labelY = geom.slider.y + 50; // push further down from wind slider

  ctx.fillStyle = "#ccc";
  ctx.fillText(`Beam Level: ${level}/16`, x0, labelY);

  geom.bBeamMinus.x = x0;
  geom.bBeamMinus.y = labelY + 8;
  geom.bBeamPlus.x = x0 + geom.bBeamMinus.w + 12;
  geom.bBeamPlus.y = labelY + 8;

  ctx.fillStyle = "rgba(50,50,50,0.6)";
  ctx.fillRect(geom.bBeamMinus.x, geom.bBeamMinus.y, geom.bBeamMinus.w, geom.bBeamMinus.h);
  ctx.fillRect(geom.bBeamPlus.x,  geom.bBeamPlus.y,  geom.bBeamPlus.w,  geom.bBeamPlus.h);
  ctx.strokeStyle = "#fff";
  ctx.strokeRect(geom.bBeamMinus.x + 0.5, geom.bBeamMinus.y + 0.5, geom.bBeamMinus.w - 1, geom.bBeamMinus.h - 1);
  ctx.strokeRect(geom.bBeamPlus.x  + 0.5, geom.bBeamPlus.y  + 0.5, geom.bBeamPlus.w  - 1, geom.bBeamPlus.h  - 1);
  ctx.fillStyle = "#ffd700";
  ctx.fillText("–", geom.bBeamMinus.x + 8, geom.bBeamMinus.y + 4);
  ctx.fillText("+", geom.bBeamPlus.x + 6, geom.bBeamPlus.y + 4);

  // --- Miasma toggle button ---
  geom.bMiasma.x = x0;
  geom.bMiasma.y = geom.bBeamMinus.y + geom.bBeamMinus.h + 40;


  ctx.fillStyle = "rgba(50,50,50,0.6)";
  ctx.fillRect(geom.bMiasma.x, geom.bMiasma.y, geom.bMiasma.w, geom.bMiasma.h);
  ctx.strokeStyle = "#fff";
  ctx.strokeRect(geom.bMiasma.x + 0.5, geom.bMiasma.y + 0.5, geom.bMiasma.w - 1, geom.bMiasma.h - 1);
  ctx.fillStyle = "#ffd700";
  ctx.fillText(`Miasma: ${config.flags.miasma ? "ON" : "OFF"}`, geom.bMiasma.x + 6, geom.bMiasma.y + 4);

  // --- Debug lines below ---
  let y = geom.bMiasma.y + geom.bMiasma.h + 12;
  const line = (txt) => { ctx.fillStyle = "#fff"; ctx.fillText(txt, geom.panel.x + 8, y); y += 14; };
  line(`Cam: ${cam.x.toFixed(1)}, ${cam.y.toFixed(1)}`);
  line(`Player: ${player.x.toFixed(1)}, ${player.y.toFixed(1)}`);
  const [tx, ty] = worldToTile(player.x, player.y, miasma.getTileSize());
  line(`Tile: ${tx}, ${ty}`);
  const o = miasma.getOrigin();
  line(`Miasma: ox=${o.ox}, oy=${o.oy}`);
  line(`Wheel: off → min → max → cone → laser`);

  // Perf meters (if available)
  if (typeof miasma.getStats === "function" && typeof miasma.getBudgets === "function") {
    const ms = miasma.getStats();
    const mb = miasma.getBudgets();
    const pct = (n, d) => d > 0 ? Math.min(1, n / d) : 0;

    y += 6;
    ctx.fillStyle = "#ccc"; ctx.fillText("Miasma Perf", geom.panel.x + 8, y); y += 14;
    drawBar("Regrow", pct(ms.lastRegrow, mb.regrowBudget), `${ms.lastRegrow}/${mb.regrowBudget}`);
    drawBar("Holes ", pct(ms.lastDrawHoles, mb.maxHolesPerFrame), `${ms.lastDrawHoles}/${mb.maxHolesPerFrame}`);
    drawBar("Map   ", pct(ms.clearedMapSize, mb.maxClearedCap), `${ms.clearedMapSize}/${mb.maxClearedCap}`);
  }

  if (typeof beam.getStats === "function") {
    const bs = beam.getStats();
    y += 4;
    ctx.fillStyle = "#ccc"; ctx.fillText("Beam Perf", geom.panel.x + 8, y); y += 14;
    ctx.fillStyle = "#ddd";
    ctx.fillText(`stamps: ${bs.stamps}  cleared: ${bs.clearedTiles}`, geom.panel.x + 8, y); y += 14;
  }

  ctx.restore();

  function drawBar(label, t, right) {
    const bx = geom.panel.x + 8, bw = 150, bh = 8;
    ctx.fillStyle = "#888"; ctx.fillText(label, bx, y - 1);
    const barX = bx + 54;
    ctx.fillStyle = "rgba(255,255,255,0.2)"; ctx.fillRect(barX, y, bw, bh);
    ctx.fillStyle = t < 0.8 ? "#7fff00" : (t < 1.0 ? "#ffbf00" : "#ff5555");
    ctx.fillRect(barX, y, Math.round(bw * t), bh);
    ctx.fillStyle = "#ddd"; ctx.fillText(right, barX + bw + 6, y - 1);
    y += 14;
  }
}
