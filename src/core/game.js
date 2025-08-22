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

// --- Wheel → “heavy swivel” controller (torque → velocity → level)
const WHEEL_STEP = 100;
const CONT_STEPS = 256;

// --- AGGRO+ (snappy but controlled)
const TORQUE_IMPULSE   = 3.6;  // keep punch
const TORQUE_DECAY_HZ  = 3.8;  // tiny bit more stick
const INERTIA          = 36;   // spins up a hair faster
const VEL_DAMPING_HZ   = 1.1;  // tiny extra baseline drag
const VEL_MAX          = 1800; // same headroom
const REVERSE_BRAKE    = 0.42; // crisper hard‑stop

// Immediate drag tied to flick speed
const DRAG_BASE_HZ     = 0.0;
const DRAG_K_HZ        = 3.6;  // stronger first‑beat bite after big flick
const DRAG_DECAY_HZ    = 5.5;  // fades a touch slower

// Minimal “kick”
const KICK_VEL_STEPS   = 120;  // keeps first flick visible, slightly less jumpy

// --- Min‑alive stop + extra‑notch‑to‑Off ---
const MIN_ACTIVE_STEP   = 7;   // tiny bubble, still readable
const MIN_ACTIVE_LEVEL  = MIN_ACTIVE_STEP / (CONT_STEPS - 1);
const OFF_DBLCLICK_MS   = 320; // forgiving up‑to‑off window




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


addEventListener("wheel", (e) => {
  const family = (typeof beam.getFamily === "function") ? beam.getFamily() : "discrete";
 const sign = (e.deltaY > 0) ? +1 : -1; // ↓ (deltaY>0) drives toward LASER, ↑ toward OFF


  if (family === "continuous") {
    const now = performance.now();
    const dt = Math.max(0, (now - wheelCtrl.lastT) / 1000);
    wheelCtrl.lastT = now;

    // fade prior torque
    wheelCtrl.torque *= Math.exp(-TORQUE_DECAY_HZ * dt);

    if (wheelCtrl.dir !== 0 && sign !== wheelCtrl.dir) {
      // HARD STOP: freeze exactly on current 1/256 step
      wheelCtrl.vel = 0;
      wheelCtrl.accSteps = 0;
      wheelCtrl.torque = 0;
      wheelCtrl.dragHz = 0;
      // Latch the stop so the very next frame can't advance due to leftover math
      wheelCtrl.stoppedUntilMs = performance.now() + 50; // ~1 frame @60fps
      wheelCtrl.dir = sign;
      e.preventDefault(); // do not add torque on this flip event
      return;
    }
    wheelCtrl.dir = sign;

    // --- Ergonomic gates: min‑alive bubble + extra notch to Off ---
    {
      const nowMs = performance.now();
      const curL  = (typeof beam.getLevel === "function") ? (beam.getLevel() || 0) : 0;

      // 1) From OFF: first DOWN notch boots to min‑alive bubble (not mid‑cone)
      if (curL <= 0.0001 && sign > 0) { // down = toward LASER
        beam.adjustLevel(MIN_ACTIVE_LEVEL - curL);
        e.preventDefault();
        return;
      }

      // 2) UP toward OFF: stop at min‑alive; require second UP (within window) to fully go Off
      const EPS = 1e-4;
      if (sign < 0 && curL <= MIN_ACTIVE_LEVEL + EPS) { // up = toward OFF
        if (nowMs <= (wheelCtrl.offArmDeadline || 0)) {
          // second UP within window -> go Off
          beam.adjustLevel(-curL);
          wheelCtrl.offArmDeadline = 0;
        } else {
          // first UP -> snap to min‑alive and arm Off
          if (curL > MIN_ACTIVE_LEVEL) beam.adjustLevel(MIN_ACTIVE_LEVEL - curL);
          wheelCtrl.offArmDeadline = nowMs + OFF_DBLCLICK_MS;
        }
        e.preventDefault();
        return;
      }
    }




    // add torque proportional to notch magnitude
    const notch = Math.min(2.5, Math.abs(e.deltaY) / WHEEL_STEP);
    wheelCtrl.torque += sign * (TORQUE_IMPULSE * notch);

    // compute instantaneous flick speed (normalized by event dt)
    const flickSpeed = dt > 0 ? (Math.abs(e.deltaY) / WHEEL_STEP) / dt : 0; // “per‑second notches”
    // set immediate drag proportional to flick speed (snaps on, then fades)
    const targetDrag = DRAG_BASE_HZ + DRAG_K_HZ * Math.min(4, flickSpeed);
    if (targetDrag > wheelCtrl.dragHz) wheelCtrl.dragHz = targetDrag;


    e.preventDefault();  // avoid page scroll
    return;
  }

  // --- discrete family: simple notch cycling (unchanged)
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
      const brake = 0.90;  // gentler coast; raise toward 0.95 to coast longer, lower to stop faster
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
