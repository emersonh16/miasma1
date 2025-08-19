import { config } from "./config.js";
import { initInput } from "./input.js";
import { makeCamera, follow } from "./camera.js";
import * as miasma from "../systems/miasma/index.js";
import * as beam from "../systems/beam/index.js";
import { makePlayer, updatePlayer, drawPlayer } from "../entities/player.js";
import { clear, drawGrid } from "../render/draw.js";
import { streamAround } from "../world/chunks.js";


const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById("game"));
const ctx = canvas.getContext("2d");

function resize() {
  canvas.width = Math.floor(innerWidth * devicePixelRatio);
  canvas.height = Math.floor(innerHeight * devicePixelRatio);
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
}
addEventListener("resize", resize);
resize();

// --- init ---
initInput();
miasma.init();
const cam = makeCamera();
const player = makePlayer();

// Mouse state (screen coords)
let mouseX = 0, mouseY = 0;
addEventListener("mousemove", (e) => {
  mouseX = e.clientX * devicePixelRatio;
  mouseY = e.clientY * devicePixelRatio;
});

// Smooth wheel accumulation → step through modes
const WHEEL_STEP = 100; // typical notch ~= 100
let wheelAcc = 0;
addEventListener("wheel", (e) => {
  wheelAcc += e.deltaY;
  // Scroll up (negative) → toward no-beam
  while (wheelAcc <= -WHEEL_STEP) {
    beam.modeUp(1);
    wheelAcc += WHEEL_STEP;
  }
  // Scroll down (positive) → toward laser
  while (wheelAcc >= WHEEL_STEP) {
    beam.modeDown(1);
    wheelAcc -= WHEEL_STEP;
  }
}, { passive: true });

// --- loop ---
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;

  // UPDATE
  updatePlayer(player, dt);
  streamAround(player.x, player.y);
  miasma.update(dt);

  // Lock camera to player (no lerp)
  cam.x = player.x;
  cam.y = player.y;

  // Aim beam at mouse (player is screen center)
  const w = canvas.width / devicePixelRatio;
  const h = canvas.height / devicePixelRatio;
  const aimX = mouseX / devicePixelRatio - w / 2;
  const aimY = mouseY / devicePixelRatio - h / 2;
  beam.setAngle(Math.atan2(aimY, aimX));

  // DRAW
  clear(ctx, w, h);


  // World-space: center the world on screen
  ctx.save();
  ctx.translate(w / 2, h / 2);

  // Grid first, then player/beam
  drawGrid(ctx, cam, w, h, 64);
  drawPlayer(ctx, cam, player);
  beam.draw(ctx, cam, player);

  ctx.restore();



  // Screen-space overlays (stay after restore)
  miasma.draw(ctx, cam, w, h);

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
