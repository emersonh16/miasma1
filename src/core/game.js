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

// --- Wheel → beam stepper with momentum (64-step continuous), dir-sensitive ramp ---
const WHEEL_STEP = 100; // typical notch ~= 100
const wheel = {
  lastT: performance.now(),
  dir: 0,           // -1 = up, +1 = down (per deltaY sign)
  momentum: 0,      // grows with sustained scroll, decays with time
  acc: 0            // for discrete mode accumulation
};
const CONT_STEPS = 256;                  // quantization for continuous level
const MOMENTUM_K = 1.0;                 // impulse per notch
const MOMENTUM_DECAY_HZ = 3.0;          // higher = faster decay
const MAX_STEP_BURST = 6;               // max steps per notch when spun fast

addEventListener("wheel", (e) => {
  const now = performance.now();
  const dt = Math.max(0, (now - wheel.lastT) / 1000);
  wheel.lastT = now;

  // Exponential momentum decay
  const decay = Math.exp(-MOMENTUM_DECAY_HZ * dt);
  wheel.momentum *= decay;

  const sign = Math.sign(e.deltaY) || 1; // +1 down, -1 up

  if (beam.getFamily() === "continuous") {
    // Direction change → "snap slow": clamp momentum low
    if (wheel.dir !== 0 && sign !== wheel.dir) {
      wheel.momentum = Math.min(wheel.momentum, 0.75);
    }
    wheel.dir = sign;

    // Add impulse proportional to wheel movement (normalize by WHEEL_STEP)
    wheel.momentum += MOMENTUM_K * Math.min(1.5, Math.abs(e.deltaY) / WHEEL_STEP);


// Map momentum (0..∞) into 0..1 curve
const eased = Math.min(1, (wheel.momentum * wheel.momentum) / (1 + wheel.momentum * wheel.momentum));
// Start gradual, then accelerate toward 1

// Scale into 1..MAX_STEP_BURST steps
const burst = 1 + eased * (MAX_STEP_BURST - 1);


    // Map level to 64 discrete steps; wheel up (deltaY<0) increases level
    const curLevel = beam.getLevel?.() ?? 0;
    const curStep  = Math.round(curLevel * (CONT_STEPS - 1));
    const dirSteps = (e.deltaY < 0 ? +1 : -1) * burst;
    let nextStep   = Math.max(0, Math.min(CONT_STEPS - 1, curStep + dirSteps));
    const nextLvl  = nextStep / (CONT_STEPS - 1);

    // Apply exact delta via adjustLevel (keeps API)
    const dLevel = nextLvl - curLevel;
    if (dLevel !== 0) beam.adjustLevel(dLevel);

    // Prevent page scroll while aiming
    e.preventDefault();
    return;
  }

  // --- Discrete family: keep original feel but with mild momentum snap ---
  // Direction change slows down by resetting accumulator slightly
  if (wheel.dir !== 0 && sign !== wheel.dir) wheel.acc *= 0.25;
  wheel.dir = sign;

  wheel.acc += e.deltaY;
  while (wheel.acc <= -WHEEL_STEP) { beam.modeUp(1);   wheel.acc += WHEEL_STEP; }
  while (wheel.acc >=  WHEEL_STEP) { beam.modeDown(1); wheel.acc -= WHEEL_STEP; }
}, { passive: false }); // passive:false so we can preventDefault() in continuous



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
