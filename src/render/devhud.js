import { config } from "../core/config.js";
import { worldToTile } from "../core/coords.js";

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
  panel:  { x: 0, y: 0, w: PANEL_W, h: PANEL_H },
  compass:{ cx: 0, cy: 0, r: COMPASS_R },
  slider: { x: 0, y: 0, w: SLIDER_W, h: SLIDER_H },
};

// interaction + UI-smoothing state
let draggingDir = false;
let draggingSpeed = false;
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

// --- Input (HUD-only) ---
addEventListener("mousedown", (e) => {
  if (!config.flags.devhud || !windModule) return;
  mouseDown = true;
  const mx = e.clientX, my = e.clientY;
  if (pointInCircle(mx, my, geom.compass)) {
    draggingDir = true; updateDirFromMouse(mx, my);
  } else if (pointInRect(mx, my, geom.slider)) {
    draggingSpeed = true; updateSpeedFromMouse(mx);
  }
});
addEventListener("mousemove", (e) => {
  if (!mouseDown) return;
  if (!config.flags.devhud || !windModule) return;
  const mx = e.clientX, my = e.clientY;
  if (draggingDir) updateDirFromMouse(mx, my);
  else if (draggingSpeed) updateSpeedFromMouse(mx);
});
function endDrag() { mouseDown = false; draggingDir = false; draggingSpeed = false; }
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
  geom.panel.x = w - PANEL_W - pad; geom.panel.y = pad;
  geom.compass.cx = geom.panel.x + 60; geom.compass.cy = geom.panel.y + 60;
  geom.slider.x = geom.panel.x + 30; geom.slider.y = geom.panel.y + 120;

  // Current wind (tiles/sec → speed/deg)
  const wv = wind.getVelocity({
    centerWX: cam.x, centerWY: cam.y,
    tileSize: miasma.getTileSize(), time: now / 1000
  });
  const rawSpeed = Math.hypot(wv.vxTilesPerSec, wv.vyTilesPerSec);
  const rawDeg = norm360((Math.atan2(wv.vyTilesPerSec, wv.vxTilesPerSec) * 180) / Math.PI);

  // Initialize smoothing targets on first frame
  if (!uiInited) {
    dispSpeed = rawSpeed;
    dispDeg = rawDeg;
    uiInited = true;
  } else {
    // Smooth both speed and direction (wrap-safe for 360°)
    dispSpeed += (rawSpeed - dispSpeed) * SMOOTH;
    dispDeg = shortestArcLerpDeg(dispDeg, rawDeg, SMOOTH);
  }

  ctx.save();
  ctx.font = "12px monospace"; ctx.textBaseline = "top";

  // Panel
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(geom.panel.x, geom.panel.y, geom.panel.w, geom.panel.h);
  ctx.strokeStyle = "rgba(255,255,255,0.2)";
  ctx.strokeRect(geom.panel.x + 0.5, geom.panel.y + 0.5, geom.panel.w - 1, geom.panel.h - 1);

  // Header
  ctx.fillStyle = "#fff";
  ctx.fillText(`FPS: ${fps}`, geom.panel.x + 8, geom.panel.y + 6);
  ctx.fillText(`Wind: ${dispSpeed.toFixed(1)} t/s @ ${Math.round(dispDeg)}°`, geom.panel.x + 8, geom.panel.y + 22);

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

  // Other debug lines
  let y = geom.slider.y + 28;
  const line = (txt) => { ctx.fillStyle = "#fff"; ctx.fillText(txt, geom.panel.x + 8, y); y += 14; };
  line(`Cam: ${cam.x.toFixed(1)}, ${cam.y.toFixed(1)}`);
  line(`Player: ${player.x.toFixed(1)}, ${player.y.toFixed(1)}`);
  const [tx, ty] = worldToTile(player.x, player.y, miasma.getTileSize());
  line(`Tile: ${tx}, ${ty}`);
  const o = miasma.getOrigin();
  line(`Miasma: ox=${o.ox}, oy=${o.oy}`);
  line(`Drag circle = dir (360°), bar = speed (~100 steps)`);

  ctx.restore();
}
