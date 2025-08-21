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
const SPEED_MAX = 120;           // keep top speed the same
const SPEED_STEPS = 100;         // ~100 increments across the bar
const SMOOTH = 0.18;             // UI smoothing factor per frame (no dt)

// positions
const geom = {
  panel:  { x: 0, y: 0, w: PANEL_W, h: PANEL_H + 108 }, // extra space for beam sliders
  compass:{ cx: 0, cy: 0, r: COMPASS_R },
  slider: { x: 0, y: 0, w: SLIDER_W, h: SLIDER_H },

  // beam sliders (stacked)
  bBubble: { x: 0, y: 0, w: SLIDER_W, h: SLIDER_H },
  bLaserL: { x: 0, y: 0, w: SLIDER_W, h: SLIDER_H },
  bLaserT: { x: 0, y: 0, w: SLIDER_W, h: SLIDER_H },
  bConeL:  { x: 0, y: 0, w: SLIDER_W, h: SLIDER_H },
  bConeA:  { x: 0, y: 0, w: SLIDER_W, h: SLIDER_H },

   // beam family toggle (NEW)
  bFamily: { x: 0, y: 0, w: 120, h: 18 },
};

// interaction + UI-smoothing state
let draggingDir = false;
let draggingSpeed = false;
let draggingBeam = null; // "bubble" | "laserL" | "laserT" | "coneL" | "coneA"
let beamModule = null;

let mouseDown = false;
let windModule = null;
let dispDeg = 0;                 // smoothed display angle (deg)
let dispSpeed = 0;               // smoothed display speed (tiles/sec)
let uiInited = false;

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
function norm360(deg) { deg %= 360; return deg < 0 ? deg + 360 : deg; }
function shortestArcLerpDeg(a, b, t) {
  // a,b in degrees. Lerp along shortest wrap-around arc.
  let d = ((b - a + 540) % 360) - 180;
  return a + d * t;
}
function pointInCircle(mx, my, c) { const dx = mx - c.cx, dy = my - c.cy; return dx*dx + dy*dy <= c.r*c.r; }
function pointInRect(mx, my, r) { return mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h; }

function setWind(patch) {
  if (!windModule) return;
  windModule.setGear(0, { ...patch, locked: true });
}

function setBeam(patch) {
  if (!beamModule) return;
  beamModule.setParams(patch);
}
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
  if (!beamModule) beamModule = beam; // allow beam sliders even if wind is absent

  mouseDown = true;
  const mx = e.clientX, my = e.clientY;

  // Wind controls
  if (pointInCircle(mx, my, geom.compass)) {
    draggingDir = true; updateDirFromMouse(mx, my);
    return;
  }
  if (pointInRect(mx, my, geom.slider)) {
    draggingSpeed = true; updateSpeedFromMouse(mx);
    return;
  }

    // Beam family toggle button (NEW)
  if (pointInRect(mx, my, geom.bFamily)) {
    beam.toggleFamily();
    return;
  }

  // Beam sliders
  const tests = [
    ["bubble", geom.bBubble],
    ["laserL", geom.bLaserL],
    ["laserT", geom.bLaserT],
    ["coneL",  geom.bConeL],
    ["coneA",  geom.bConeA],
  ];
  for (const [name, r] of tests) {
    if (pointInRect(mx, my, r)) { draggingBeam = name; updateBeamFromMouse(mx, name); return; }
  }
});

addEventListener("mousemove", (e) => {
  if (!mouseDown || !config.flags.devhud) return;
  const mx = e.clientX, my = e.clientY;
  if (draggingDir)       { updateDirFromMouse(mx, my); return; }
  if (draggingSpeed)     { updateSpeedFromMouse(mx);   return; }
  if (draggingBeam)      { updateBeamFromMouse(mx, draggingBeam); return; }
});

function endDrag() { mouseDown = false; draggingDir = false; draggingSpeed = false; draggingBeam = null; }
addEventListener("mouseup", endDrag);
addEventListener("mouseleave", endDrag);
addEventListener("blur", endDrag);

function updateDirFromMouse(mx, my) {
  const dx = mx - geom.compass.cx;
  const dy = my - geom.compass.cy;
  const angleDeg = norm360((Math.atan2(dy, dx) * 180) / Math.PI); // 0° = east
  setWind({ dirDeg: angleDeg });
}
function updateSpeedFromMouse(mx) {
  const t = clamp((mx - geom.slider.x) / geom.slider.w, 0, 1);
  const q = Math.round(t * SPEED_STEPS) / SPEED_STEPS;             // quantize to ~100 steps
  const spd = SPEED_MIN + q * (SPEED_MAX - SPEED_MIN);
  setWind({ speedTilesPerSec: spd });
}

function updateBeamFromMouse(mx, which) {
  if (!beamModule) return;
  const clamp01 = (t) => Math.max(0, Math.min(1, t));

  // [rect, min, max, key, formatter]
  const map = {
    bubble: [geom.bBubble, 16, 256, "bubbleRadius",       (v) => `${Math.round(v*2)} px Ø`], // 32–512 Ø
    laserL: [geom.bLaserL, 96, 640, "laserLength",        (v) => `${Math.round(v)} px`],
    laserT: [geom.bLaserT, 2,  24,  "laserThickness",     (v) => `${v.toFixed(1)} px`],
    coneL:  [geom.bConeL,  128,512, "coneLength",         (v) => `${Math.round(v)} px`],
    // CHANGE: drive TOTAL cone angle 4°..64°, beam module converts to half-angle internally
    coneA:  [geom.bConeA,   4,  64, "coneAngleTotalDeg",  (v) => `${Math.round(v)}°`],
  };

  const row = map[which];
  if (!row) return;
  const [rect, lo, hi, key] = row;
  const t = clamp01((mx - rect.x) / rect.w);
  const val = lo + t * (hi - lo);
  if (key === "coneAngleTotalDeg") {
    setBeam({ coneAngleTotalDeg: val });
  } else {
    setBeam({ [key]: val });
  }
}


/**
 * Dev HUD overlay (interactive wind controls)
 */
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

// place BeamMode toggle right below header
geom.bFamily.x = geom.panel.x + 20;
geom.bFamily.y = geom.panel.y + 40;

// then push compass down a bit lower to make room
geom.compass.cx = geom.panel.x + 60; 
geom.compass.cy = geom.bFamily.y + 50;

// slider row follows compass
geom.slider.x = geom.panel.x + 30; 
geom.slider.y = geom.compass.cy + 60;


  // Current wind (tiles/sec → speed/deg)
  const wv = wind.getVelocity({
    centerWX: cam.x, centerWY: cam.y,
    tileSize: miasma.getTileSize(), time: now / 1000
  });

  const rawSpeed = Math.hypot(wv.vxTilesPerSec, wv.vyTilesPerSec);
  const rawDegUpwind = norm360((Math.atan2(wv.vyTilesPerSec, wv.vxTilesPerSec) * 180) / Math.PI);
  const targetDegDownwind = norm360(rawDegUpwind + 180); // flip to downwind

  // Initialize smoothing targets on first frame
  if (!uiInited) {
    dispSpeed = rawSpeed;
    dispDeg = targetDegDownwind;
    uiInited = true;
  } else {
    // Smooth both speed and direction (wrap-safe for 360°)
    dispSpeed += (rawSpeed - dispSpeed) * SMOOTH;
    dispDeg = shortestArcLerpDeg(dispDeg, targetDegDownwind, SMOOTH);
  }



  ctx.save();
  ctx.font = "12px monospace"; ctx.textBaseline = "top";

  // Panel
  ctx.fillStyle = "rgba(0,0,0,0.5)";
 // compute panel height dynamically down to bottom diagnostics
const panelBottom = h - 20; // 20px margin above bottom of screen
const panelHeight = panelBottom - geom.panel.y;
ctx.fillRect(geom.panel.x, geom.panel.y, geom.panel.w, panelHeight);
  ctx.strokeStyle = "rgba(255,255,255,0.2)";
  ctx.strokeRect(geom.panel.x + 0.5, geom.panel.y + 0.5, geom.panel.w - 1, geom.panel.h - 1);

  // Header
  ctx.fillStyle = "#fff";
  ctx.fillText(`FPS: ${fps}`, geom.panel.x + 8, geom.panel.y + 6);
  ctx.fillText(`Wind: ${dispSpeed.toFixed(1)} t/s @ ${Math.round(dispDeg)}° (downwind)`, geom.panel.x + 8, geom.panel.y + 22);




  // Compass
  ctx.save();
  ctx.translate(geom.compass.cx, geom.compass.cy);
  ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(0, 0, geom.compass.r, 0, Math.PI * 2); ctx.stroke();

  // minor ticks (every 30° for better 360° feel)
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6;
    const x = Math.cos(a) * (geom.compass.r - 3);
    const y = Math.sin(a) * (geom.compass.r - 3);
    const ix = Math.cos(a) * (geom.compass.r - 8);
    const iy = Math.sin(a) * (geom.compass.r - 8);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ix, iy); ctx.stroke();
  }

  // needle (0° = +X)
  ctx.rotate((dispDeg * Math.PI) / 180);
  ctx.fillStyle = "#ffd700";
  ctx.beginPath(); ctx.moveTo(geom.compass.r - 4, 0); ctx.lineTo(-10, -4); ctx.lineTo(-10, 4); ctx.closePath(); ctx.fill();
  ctx.restore();

  // Speed slider
  ctx.fillStyle = "#ccc"; ctx.fillText("Speed", geom.slider.x, geom.slider.y - 14);
  ctx.fillStyle = "rgba(255,255,255,0.2)";
  ctx.fillRect(geom.slider.x, geom.slider.y, geom.slider.w, geom.slider.h);

  const t = clamp((dispSpeed - SPEED_MIN) / (SPEED_MAX - SPEED_MIN), 0, 1);
  const knobX = Math.round(geom.slider.x + t * geom.slider.w);
  const knobY = geom.slider.y + geom.slider.h / 2;
  ctx.fillStyle = "#ffd700";
  ctx.beginPath(); ctx.arc(knobX, knobY, 6, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.7)"; ctx.stroke();

  // --- Beam sliders layout (stacked under wind slider) ---
  const BP = (typeof beam.getParams === "function")
    ? beam.getParams()
    : { bubbleRadius: 64, laserLength: 384, laserThickness: 8, coneLength: 224, coneHalfAngleDeg: 64 };

  const x0 = geom.panel.x + 30;
  let y0 = geom.slider.y + 40; // start a bit below the wind speed slider
  const gap = 22;

  // place rects
  geom.bBubble.x = x0; geom.bBubble.y = y0; y0 += gap;
  geom.bLaserL.x = x0; geom.bLaserL.y = y0; y0 += gap;
  geom.bLaserT.x = x0; geom.bLaserT.y = y0; y0 += gap;
  geom.bConeL.x  = x0; geom.bConeL.y  = y0; y0 += gap;
  geom.bConeA.x  = x0; geom.bConeA.y  = y0;

  // section label
  ctx.fillStyle = "#ccc";
  ctx.fillText("Beam", geom.panel.x + 8, geom.slider.y + 24);

  // draw sliders (t is 0..1 normalized value in each range)
  drawSlider(
    ctx, geom.bBubble,
    (BP.bubbleRadius - 16) / (256 - 16),
    "Bubble", `${Math.round(BP.bubbleRadius * 2)} px Ø`
  );
  drawSlider(
    ctx, geom.bLaserL,
    (BP.laserLength - 96) / (640 - 96),
    "Laser Len", `${Math.round(BP.laserLength)} px`
  );
  drawSlider(
    ctx, geom.bLaserT,
    (BP.laserThickness - 2) / (24 - 2),
    "Laser Thick", `${BP.laserThickness.toFixed(1)} px`
  );
  drawSlider(
    ctx, geom.bConeL,
    (BP.coneLength - 128) / (512 - 128),
    "Cone Len", `${Math.round(BP.coneLength)} px`
  );

  // CHANGE: show TOTAL cone angle 4°..64° (internally stored as half-angle)
  const totalA = Math.round((BP.coneAngleTotalDeg ?? (BP.coneHalfAngleDeg * 2)));
  const tCone = (totalA - 4) / (64 - 4);
  drawSlider(
    ctx, geom.bConeA,
    Math.max(0, Math.min(1, tCone)),
    "Cone Angle", `${totalA}°`
  );



  // --- Other debug lines (push below the last slider) ---
  // --- BeamMode toggle button (just above diagnostics) ---
geom.bFamily.x = geom.panel.x + 30;
geom.bFamily.y = geom.bConeA.y + 60;  // leave extra space after sliders

ctx.fillStyle = "rgba(50,50,50,0.6)";
ctx.fillRect(geom.bFamily.x, geom.bFamily.y, geom.bFamily.w, geom.bFamily.h);
ctx.strokeStyle = "#fff";
ctx.strokeRect(geom.bFamily.x + 0.5, geom.bFamily.y + 0.5, geom.bFamily.w - 1, geom.bFamily.h - 1);
ctx.fillStyle = "#ffd700";
ctx.fillText(`BeamMode: ${beam.getFamily()}`, geom.bFamily.x + 6, geom.bFamily.y + 4);

// --- Other debug lines (push below the toggle) ---
let y = geom.bFamily.y + geom.bFamily.h + 20;

  const line = (txt) => { ctx.fillStyle = "#fff"; ctx.fillText(txt, geom.panel.x + 8, y); y += 14; };
  line(`Cam: ${cam.x.toFixed(1)}, ${cam.y.toFixed(1)}`);
  line(`Player: ${player.x.toFixed(1)}, ${player.y.toFixed(1)}`);
  const [tx, ty] = worldToTile(player.x, player.y, miasma.getTileSize());
  line(`Tile: ${tx}, ${ty}`);
  const o = miasma.getOrigin();
  line(`Miasma: ox=${o.ox}, oy=${o.oy}`);
  line(`Drag: circle=dir, bar=speed, sliders=beam`);

  ctx.restore();
}
