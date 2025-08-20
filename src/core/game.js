import { config } from "./config.js";
import { initInput, axis } from "./input.js";
import { makeCamera /*, follow */ } from "./camera.js";
import * as miasma from "../systems/miasma/index.js";
import * as beam from "../systems/beam/index.js";
import { makePlayer, drawPlayer } from "../entities/player.js";
import { clear, drawGrid } from "../render/draw.js";
import * as chunks from "../world/chunks.js";
import * as wind from "../systems/wind/index.js";
import { drawDevHUD } from "../render/devhud.js";

// --- Canvas ---
const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById("game"));
const ctx = canvas.getContext("2d");

// --- Input & actors ---
initInput();
const cam = makeCamera();
const player = makePlayer();

// --- Resize/init miasma centered on camera ---
function resize() {
  canvas.width = Math.floor(innerWidth * devicePixelRatio);
  canvas.height = Math.floor(innerHeight * devicePixelRatio);
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);

  const viewW = canvas.width / devicePixelRatio;
  const viewH = canvas.height / devicePixelRatio;
  miasma.init(viewW, viewH, cam.x, cam.y);
}
addEventListener("resize", resize);
resize();

// --- Wind (debug: off) ---
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

// --- Wheel → beam mode stepper ---
const WHEEL_STEP = 100; // typical notch ~= 100
let wheelAcc = 0;
addEventListener("wheel", (e) => {
  wheelAcc += e.deltaY;
  while (wheelAcc <= -WHEEL_STEP) { beam.modeUp(1); wheelAcc += WHEEL_STEP; }
  while (wheelAcc >=  WHEEL_STEP) { beam.modeDown(1); wheelAcc -= WHEEL_STEP; }
}, { passive: true });

// --- Main loop ---
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;

  // UPDATE — slide world under spindle (camera = world record)
  const a = axis();
  const speed = config.player.speed;
  const prevCamX = cam.x, prevCamY = cam.y;

  cam.x += a.x * speed * dt;
  cam.y += a.y * speed * dt;

  // Player stays at camera center (for aim)
  player.x = cam.x;
  player.y = cam.y;

  // Stream chunks around camera center
  chunks.streamAround(cam.x, cam.y);

  // View size
  const w = canvas.width / devicePixelRatio;
  const h = canvas.height / devicePixelRatio;

  // Real world motion under camera (camera delta + wind drift)
  const camMotion = { x: cam.x - prevCamX, y: cam.y - prevCamY };

  const windVel = wind.getVelocity({
    centerWX: cam.x,
    centerWY: cam.y,
    tileSize: miasma.getTileSize(),
    time: now / 1000
  });
  // convert from tiles/sec → world units/sec
  const tileSize = miasma.getTileSize();
  const windMotion = {
    x: windVel.vxTilesPerSec * tileSize * dt,
    y: windVel.vyTilesPerSec * tileSize * dt
  };

  const worldMotion = {
    x: -camMotion.x + windMotion.x,
    y: -camMotion.y + windMotion.y
  };

  miasma.update(dt, cam.x, cam.y, worldMotion, w, h);

  // Aim beam at mouse (screen center = player)
  const aimX = mouseX / devicePixelRatio - w / 2;
  const aimY = mouseY / devicePixelRatio - h / 2;
  beam.setAngle(Math.atan2(aimY, aimX));
  beam.raycast(player, beam.getAngle());

  // DRAW
  clear(ctx, w, h);

  // World space
  ctx.save();
  ctx.translate(w / 2, h / 2);

  if (config.flags.grid) {
    drawGrid(ctx, cam, w, h, 64);
  }

  // World draw (beam first, player on top)
  beam.draw(ctx, cam, player);
  drawPlayer(ctx, cam, player);

  ctx.restore();

  // Screen-space overlays
  miasma.draw(ctx, cam, w, h);

  // Developer HUD
  drawDevHUD(ctx, cam, player, { x: mouseX, y: mouseY }, miasma, wind, w, h);

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
