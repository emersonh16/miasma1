import { config } from "./config.js";
import { initInput, axis } from "./input.js";
import { makeCamera /*, follow */ } from "./camera.js";
import * as miasma from "../systems/miasma/index.js";
import * as beam from "../systems/beam/index.js";
import { makePlayer, drawPlayer } from "../entities/player.js";
import { clear, drawGrid, drawRocks } from "../render/draw.js";
import * as chunks from "../world/chunks.js";
import * as wind from "../systems/wind/index.js";
import { drawDevHUD } from "../render/devhud.js";
import { drawHUD } from "../render/hud.js";
import * as rocks from "../systems/rocks/index.js";
import { drawEnemies, updateEnemy } from "../entities/enemy.js";
import { iterEntitiesInAABB } from "../world/store.js";




// --- Canvases ---
// Base/world canvas (already in DOM)
const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById("game"));
const ctx = canvas.getContext("2d");

// Fog overlay (stacked above base)
const fogCanvas = document.createElement("canvas");
const fogCtx = fogCanvas.getContext("2d", { alpha: true });

// Ensure both canvases share the SAME parent and CSS box
const parent = canvas.parentElement || document.body;
if (!parent.style.position) parent.style.position = "relative";
Object.assign(canvas.style,   { position: "absolute", left: "0", top: "0", width: "100%", height: "100%", display: "block", zIndex: "0" });
Object.assign(fogCanvas.style,{ position: "absolute", left: "0", top: "0", width: "100%", height: "100%", display: "block", zIndex: "1", pointerEvents: "none" });
parent.appendChild(fogCanvas);

// --- Input & actors ---
initInput();
const cam = makeCamera();
const player = makePlayer();


function resize() {
  const dpr = devicePixelRatio || 1;
  const cssW = Math.floor(innerWidth);
  const cssH = Math.floor(innerHeight);

  // Match backing store sizes
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  fogCanvas.width = canvas.width;
  fogCanvas.height = canvas.height;

  // Identical transforms
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  fogCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Turn off smoothing (prevents shimmer blur differences)
  ctx.imageSmoothingEnabled = false;
  fogCtx.imageSmoothingEnabled = false;

  const viewW = canvas.width / dpr;
  const viewH = canvas.height / dpr;
  miasma.init(viewW, viewH, cam.x, cam.y);
}
addEventListener("resize", resize);
resize();

// --- Wind (debug default) ---
wind.clearGears();
wind.addGear({
  locked: true,
  dirDeg: 0,
  speedTilesPerSec: 0,
  coverage: () => 0,
});
wind.setGear(0, { locked: true, dirDeg: 45, speedTilesPerSec: 50, coverage: () => 1 });

// --- Mouse state (screen coords) ---
let mouseX = 0, mouseY = 0;
addEventListener("mousemove", (e) => {
  mouseX = e.clientX * devicePixelRatio;
  mouseY = e.clientY * devicePixelRatio;
});

// --- Wheel → controller
const WHEEL_STEP = 100;
const CONT_STEPS = 256;

// Arcade snap — faster response, shorter coast
const TORQUE_IMPULSE   = 3.2;  // a touch less shove (reduces runaway)
const TORQUE_DECAY_HZ  = 4.6;  // torque fades quicker
const INERTIA          = 34;   // snappy spin-up
const VEL_DAMPING_HZ   = 1.7;  // stronger baseline damping → stops sooner
const VEL_MAX          = 1600; // slightly lower top speed
const REVERSE_BRAKE    = 0.65; // flips feel crisp

// Kill fancy drag bursts for clarity (set base small, strong decay)
const DRAG_BASE_HZ     = 0.08;
const DRAG_K_HZ        = 0.0;
const DRAG_DECAY_HZ    = 6.0;

// Smaller initial kick so tiny flicks don’t overshoot
const KICK_VEL_STEPS   = 80;


// Min‑alive + Off
const MIN_ACTIVE_STEP   = 7;
const MIN_ACTIVE_LEVEL  = MIN_ACTIVE_STEP / (CONT_STEPS - 1);
const OFF_DBLCLICK_MS   = 320;






const wheelCtrl = {
  lastT: performance.now(),
  dir: 0,
  torque: 0,
  vel: 0,
  accSteps: 0,
  discAcc: 0,
  dragHz: 0,
  offArmDeadline: 0,   // <= now means not armed
};


function ease01(x) {              // snappier S-curve 0..1
  const xxx = x * x * x;          // x^3 /(1+x^3) → slower start, faster rise
  return xxx / (1 + xxx);
}

// 16-step stepper: 0 = OFF, 1..15 = bubble→cone, 16 = LASER
// Snappier: larger deltas step multiple levels; quick successive notches add +1 bonus.
addEventListener("wheel", (e) => {
  const family = (typeof beam.getFamily === "function") ? beam.getFamily() : "discrete";
  const sign = (e.deltaY > 0) ? +1 : -1; // ↓ attack (toward laser), ↑ retreat (toward off)

  if (family === "continuous") {
    const nowMs = performance.now();
    const idx = (typeof beam.getLevelIndex === "function") ? beam.getLevelIndex() : 0; // 0..3

    // 3 transitions (4 states): 0=OFF → 1=MAX BUBBLE → 2=CONE → 3=LASER
    const steps = 1;
    const next = Math.max(0, Math.min(3, idx + (sign > 0 ? +steps : -steps)));

    if (typeof beam.setLevelIndex === "function") beam.setLevelIndex(next);
    wheelCtrl.lastWheelMs = nowMs;
    e.preventDefault();
    return;
  }


  // legacy discrete family behavior (unchanged)
  wheelCtrl.discAcc += e.deltaY;
  while (wheelCtrl.discAcc <= -WHEEL_STEP) { beam.modeUp(1);   wheelCtrl.discAcc += WHEEL_STEP; }
  while (wheelCtrl.discAcc >=  WHEEL_STEP) { beam.modeDown(1); wheelCtrl.discAcc -= WHEEL_STEP; }
}, { passive: false });


// --- Game state (pause/death) ---
const state = { paused: false, dead: false };

// Simple restart (hard reset keeps miasma simple for now)
function restart() {
  try { location.reload(); } catch (_) {
    // Fallback soft reset
    state.paused = false; state.dead = false;
    player.health = player.maxHealth ?? 100;
    cam.x = cam.y = 0;
    const dpr = devicePixelRatio || 1;
    const w = canvas.width / dpr, h = canvas.height / dpr;
    miasma.init(w, h, cam.x, cam.y); // re-center fog:contentReference[oaicite:1]{index=1}
  }
}

// Pause = Space; Reload = R
addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (k === " ") {                // space bar
    state.paused = !state.paused;
    e.preventDefault();           // prevent page scroll
  }
  if (k === "r") restart();

  // Toggle DevHUD on/off (no work when off)
  if (k === "h") {
    config.flags.devhud = !config.flags.devhud;
  }
});



// --- Main loop ---
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;

  // View size
  const w = canvas.width / devicePixelRatio;
  const h = canvas.height / devicePixelRatio;

  // UPDATE — only when not paused/dead
  if (!state.paused && !state.dead) {
    const a = axis();
    const speed = config.player.speed;
    const dx = a.x * speed * dt;
    const dy = a.y * speed * dt;

    const { x, y } = rocks.movePlayer(cam, dx, dy, player.r || 16);
    player.x = x;
    player.y = y;

    // Stream chunks around camera center
    chunks.streamAround(cam.x, cam.y);

    // Wind + miasma
    const windVel = wind.getVelocity({
      centerWX: cam.x,
      centerWY: cam.y,
      tileSize: miasma.getTileSize(),
      time: now / 1000
    });
    const tileSize = miasma.getTileSize();
    const windMotion = {
      x: windVel.vxTilesPerSec * tileSize * dt,
      y: windVel.vyTilesPerSec * tileSize * dt
    };

    if (config.flags.miasma) {
      miasma.update(dt, cam.x, cam.y, windMotion, w, h);
    }

    // Rocks: ensure clusters near view
    rocks.ensureRocksForView(player.x, player.y);

    // Update enemies
    const ax = cam.x - w / 2;
    const ay = cam.y - h / 2;
    const bx = cam.x + w / 2;
    const by = cam.y + h / 2;
    for (const e of iterEntitiesInAABB(ax, ay, bx, by)) {
      if (e.type === "enemy") updateEnemy(e, dt, player);
    }



    // Health management
    if (player.maxHealth == null) player.maxHealth = 100;
    if (!Number.isFinite(player.health)) player.health = player.maxHealth;

    if (config.flags.miasma && miasma.sample(player.x, player.y) === 1) {
      player.health -= dt * 5; // 5 HP/sec in fog
      if (player.health < 0) player.health = 0;
    }

    if (player.health <= 0) {
      state.dead = true;
    }
  }
  // --- Integrate heavy swivel feel (continuous only)
  if (!state.paused && !state.dead && typeof beam.getFamily === "function" && beam.getFamily() === "continuous") {
    // HARD STOP latch: if we just flipped direction, freeze for one frame
    if (wheelCtrl.stoppedUntilMs && performance.now() <= wheelCtrl.stoppedUntilMs) {
      wheelCtrl.vel = 0;
      wheelCtrl.torque = 0;
      wheelCtrl.accSteps = 0;
      // skip the rest of integration this frame
    } else {
      // decay torque over time
      wheelCtrl.torque *= Math.exp(-TORQUE_DECAY_HZ * dt);

      // torque → accel (steps/sec^2), then apply friction to velocity
      const gain  = ease01(Math.abs(wheelCtrl.torque));        // 0..1

    const accel = Math.sign(wheelCtrl.torque) * (gain / INERTIA) * 1000; // scaled
    wheelCtrl.vel += accel * dt;
    // --- DAMPING: baseline + instantaneous flick‑drag (decays over time)
    wheelCtrl.dragHz *= Math.exp(-DRAG_DECAY_HZ * dt);            // fade extra drag from the last flick
    const totalDampHz = VEL_DAMPING_HZ + wheelCtrl.dragHz;        // heavier immediate drag after big flicks
    wheelCtrl.vel *= Math.exp(-totalDampHz * dt);

    // --- BRAKE (coast): only when user isn’t pushing
    if (Math.abs(wheelCtrl.torque) < 0.001) {
      const brake = 0.86;  // gentler coast; raise toward 0.95 to coast longer, lower to stop faster
      wheelCtrl.vel *= (1 - (1 - brake) * dt * 60);
    }

    // Kick so first flick is immediately visible
    if (Math.abs(wheelCtrl.torque) > 0.001 && Math.abs(wheelCtrl.vel) < KICK_VEL_STEPS) {
      wheelCtrl.vel = Math.sign(wheelCtrl.torque) * KICK_VEL_STEPS;
    }



    // clamp velocity
    if (wheelCtrl.vel >  VEL_MAX) wheelCtrl.vel =  VEL_MAX;
    if (wheelCtrl.vel < -VEL_MAX) wheelCtrl.vel = -VEL_MAX;

    // integrate velocity into quantized level steps
    wheelCtrl.accSteps += wheelCtrl.vel * dt;
    const whole = (wheelCtrl.accSteps > 0) ? Math.floor(wheelCtrl.accSteps)
                                           : Math.ceil(wheelCtrl.accSteps);
    if (whole !== 0 && typeof beam.getLevel === "function") {
      const curLevel = beam.getLevel() || 0;
      const curStep  = Math.round(curLevel * (CONT_STEPS - 1));
      const nextStep = Math.max(0, Math.min(CONT_STEPS - 1, curStep + whole));
      if (nextStep !== curStep) {
        const nextLevel = nextStep / (CONT_STEPS - 1);
        beam.adjustLevel(nextLevel - curLevel);
      }
      wheelCtrl.accSteps -= whole; // keep fractional residue
    }

       // deadzone cleanup
      if (Math.abs(wheelCtrl.vel) < 0.01 && Math.abs(wheelCtrl.torque) < 0.01) {
        wheelCtrl.vel = 0; wheelCtrl.torque = 0; wheelCtrl.accSteps = 0;
      }
    } // <- closes the else for hard-stop latch
  }

  // reset latch once time has passed
  if (wheelCtrl.stoppedUntilMs && performance.now() > wheelCtrl.stoppedUntilMs) {
    wheelCtrl.stoppedUntilMs = 0;
  }



  // Aim beam at mouse (screen center = player)
  const aimX = mouseX / devicePixelRatio - w / 2;
  const aimY = mouseY / devicePixelRatio - h / 2;
  beam.setAngle(Math.atan2(aimY, aimX));
  if (!state.paused && !state.dead) {
    beam.raycast(player, beam.getAngle());
  }

  // --- DRAW (two-layer pipeline) ---

  // Base/world layer
  ctx.clearRect(0, 0, w, h);
  clear(ctx, w, h, cam);
  ctx.save();
  ctx.translate(w / 2, h / 2);
  if (config.flags.grid) drawGrid(ctx, cam, w, h, 64);
  rocks.draw(ctx, cam, w, h);


  // Draw enemies before beam/player
  drawEnemies(ctx, cam, w, h);


  beam.draw(ctx, cam, player);
  drawPlayer(ctx, cam, player);

  ctx.restore();

  // Fog overlay
  fogCtx.clearRect(0, 0, w, h);
  if (config.flags.miasma) {
    miasma.draw(fogCtx, cam, w, h);
  }
  // DevHUD does nothing when off (no layout, no meters, no input work)
  if (config.flags.devhud) {
    drawDevHUD(fogCtx, cam, player, { x: mouseX, y: mouseY }, miasma, wind, w, h);
  }
  // Basic HUD always draws (includes tiny FPS label)
  drawHUD(fogCtx, player, w, h);


  // Pause/Death overlays
  if (state.paused || state.dead) {
    fogCtx.save();
    fogCtx.fillStyle = "rgba(0,0,0,0.5)";
    fogCtx.fillRect(0, 0, w, h);
    fogCtx.fillStyle = "#fff";
    fogCtx.font = "28px monospace";
    fogCtx.textAlign = "center";
    fogCtx.textBaseline = "middle";
    const title = state.dead ? "YOU DIED" : "PAUSED";
    const sub   = state.dead ? "Press R to restart" : "Press Esc or P to resume • R to restart";
    fogCtx.fillText(title, w / 2, h / 2 - 16);
    fogCtx.font = "16px monospace";
    fogCtx.fillText(sub,   w / 2, h / 2 + 14);
    fogCtx.restore();
  }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
