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
  bMiasma: { x: 0, y: 0, w: 120, h: 18 },

  // beam sliders (stacked) — discrete only
  bBubbleMin: { x: 0, y: 0, w: SLIDER_W, h: SLIDER_H },
  bBubbleMax: { x: 0, y: 0, w: SLIDER_W, h: SLIDER_H },
  bLaserL:    { x: 0, y: 0, w: SLIDER_W, h: SLIDER_H },
  bLaserT:    { x: 0, y: 0, w: SLIDER_W, h: SLIDER_H },
  bConeL:     { x: 0, y: 0, w: SLIDER_W, h: SLIDER_H },
  bConeA:     { x: 0, y: 0, w: SLIDER_W, h: SLIDER_H },
};

// interaction + UI-smoothing state
let draggingDir = false;
let draggingSpeed = false;
let draggingBeam = null; // "bubbleMin" | "bubbleMax" | "laserL" | "laserT" | "coneL" | "coneA"
let beamModule = null;

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
function setBeam(patch) { if (!beamModule) return; beamModule.setParams(patch); }

function drawSlider(ctx, rect, t, label, fmtVal) {
  ctx.fillStyle = "rgba(255,255,255,0.2)";
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  const knobX = Math.round(rect.x + t * rect.w);
  const knobY = rect.y + rect.h / 2;
  ctx.fillStyle = "#ffd700";
  ctx.beginPath(); ctx.arc(knobX, knobY, 6, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.7)"; ctx.stroke();
  if (label) {
    ctx.fillStyle = "#ccc";
    ctx.fillText(`${label}: ${fmtVal}`, rect.x, rect.y - 14);
  }
}

// --- Input (HUD-only) ---
addEventListener("mousedown", (e) => {
  if (!config.flags.devhud) return;
  if (!beamModule) beamModule = beam;

  mouseDown = true;
  const mx = e.clientX, my = e.clientY;

  // Wind controls
  if (pointInCircle(mx, my, geom.compass)) { draggingDir = true; updateDirFromMouse(mx, my); return; }
  if (pointInRect(mx, my, geom.slider))    { draggingSpeed = true; updateSpeedFromMouse(mx);  return; }

  // Miasma toggle button
  if (pointInRect(mx, my, geom.bMiasma)) { config.flags.miasma = !config.flags.miasma; return; }

  // Beam sliders
  const tests = [
    ["bubbleMin", geom.bBubbleMin],
    ["bubbleMax", geom.bBubbleMax],
    ["laserL",    geom.bLaserL],
    ["laserT",    geom.bLaserT],
    ["coneL",     geom.bConeL],
    ["coneA",     geom.bConeA],
  ];
  for (const [name, r] of tests) {
    if (pointInRect(mx, my, r)) { draggingBeam = name; updateBeamFromMouse(mx, name); return; }
  }
});
addEventListener("mousemove", (e) => {
  if (!mouseDown || !config.flags.devhud) return;
  const mx = e.clientX, my = e.clientY;
  if (draggingDir)   { updateDirFromMouse(mx, my); return; }
  if (draggingSpeed) { updateSpeedFromMouse(mx);   return; }
  if (draggingBeam)  { updateBeamFromMouse(mx, draggingBeam); return; }
});
function endDrag() { mouseDown = false; draggingDir = false; draggingSpeed = false; draggingBeam = null; }
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
function updateBeamFromMouse(mx, which) {
  if (!beamModule) return;
  const clamp01 = (t) => Math.max(0, Math.min(1, t));

  // [rect, min, max, key, formatter]
  const map = {
    bubbleMin: [geom.bBubbleMin, 16, 256, "bubbleMinRadius", (v) => `${Math.round(v*2)} px Ø`],
    bubbleMax: [geom.bBubbleMax, 32, 512, "bubbleMaxRadius", (v) => `${Math.round(v*2)} px Ø`],
    laserL:    [geom.bLaserL,   128, 1024, "laserLength",    (v) => `${Math.round(v)} px`],
    laserT:    [geom.bLaserT,     4,   48,  "laserThickness", (v) => `${v.toFixed(1)} px`],
    coneL:     [geom.bConeL,    128,  512,  "coneLength",     (v) => `${Math.round(v)} px`],
    // total cone angle; beam module converts to half-angle internally
    coneA:     [geom.bConeA,      4,   64,  "coneAngleTotalDeg",(v) => `${Math.round(v)}°`],
  };

  const row = map[which];
  if (!row) return;
  const [rect, lo, hi, key] = row;
  const t = clamp01((mx - rect.x) / rect.w);
  const val = lo + t * (hi - lo);
  if (key === "coneAngleTotalDeg") setBeam({ coneAngleTotalDeg: val });
  else setBeam({ [key]: val });
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

  // --- Beam sliders layout (stacked under wind slider) ---
  const BP = (typeof beam.getParams === "function")
    ? beam.getParams()
    : { bubbleMinRadius: 48, bubbleMaxRadius: 128, laserLength: 512, laserThickness: 12, coneLength: 224, coneAngleTotalDeg: 64 };

  const x0 = geom.panel.x + 30;
  let y0 = geom.slider.y + 40;
  const gap = 22;

  geom.bBubbleMin.x = x0; geom.bBubbleMin.y = y0; y0 += gap;
  geom.bBubbleMax.x = x0; geom.bBubbleMax.y = y0; y0 += gap;
  geom.bLaserL.x    = x0; geom.bLaserL.y    = y0; y0 += gap;
  geom.bLaserT.x    = x0; geom.bLaserT.y    = y0; y0 += gap;
  geom.bConeL.x     = x0; geom.bConeL.y     = y0; y0 += gap;
  geom.bConeA.x     = x0; geom.bConeA.y     = y0;

  // section label
  ctx.fillStyle = "#ccc";
  ctx.fillText("Beam (discrete)", geom.panel.x + 8, geom.slider.y + 24);

  // draw sliders
  drawSlider(ctx, geom.bBubbleMin, (BP.bubbleMinRadius - 16) / (256 - 16), "Bubble Min", `${Math.round(BP.bubbleMinRadius * 2)} px Ø`);
  drawSlider(ctx, geom.bBubbleMax, (BP.bubbleMaxRadius - 32) / (512 - 32), "Bubble Max", `${Math.round(BP.bubbleMaxRadius * 2)} px Ø`);
  drawSlider(ctx, geom.bLaserL,    (BP.laserLength - 128) / (1024 - 128), "Laser Len",  `${Math.round(BP.laserLength)} px`);
  drawSlider(ctx, geom.bLaserT,    (BP.laserThickness - 4) / (48 - 4),     "Laser Thick",`${BP.laserThickness.toFixed(1)} px`);
  drawSlider(ctx, geom.bConeL,     (BP.coneLength - 128) / (512 - 128),    "Cone Len",   `${Math.round(BP.coneLength)} px`);

  const totalA = Math.round(BP.coneAngleTotalDeg ?? 64);
  const tCone  = (totalA - 4) / (64 - 4);
  drawSlider(ctx, geom.bConeA, Math.max(0, Math.min(1, tCone)), "Cone Angle", `${totalA}°`);

  // --- Miasma toggle button ---
  geom.bMiasma.x = x0;
  geom.bMiasma.y = geom.bConeA.y + 60;

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
