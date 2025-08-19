import { config } from "./config.js";
import { initInput, axis } from "./input.js";
import { makeCamera, follow } from "./camera.js";
import * as miasma from "../systems/miasma/index.js";
import * as beam from "../systems/beam/index.js";
import { makePlayer, updatePlayer, drawPlayer } from "../entities/player.js";
import { clear, drawGrid } from "../render/draw.js";
import * as chunks from "../world/chunks.js";
import * as wind from "../systems/wind/index.js";



const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById("game"));
const ctx = canvas.getContext("2d");

function resize() {
  canvas.width = Math.floor(innerWidth * devicePixelRatio);
  canvas.height = Math.floor(innerHeight * devicePixelRatio);
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);

  // Re-init miasma with the real view size (in world units == screen px)
  const viewW = canvas.width / devicePixelRatio;
  const viewH = canvas.height / devicePixelRatio;
  miasma.init(viewW, viewH);
}
addEventListener("resize", resize);
resize();


// --- init ---
initInput();
// after canvas size & transform are set
const viewW = canvas.width / devicePixelRatio;
const viewH = canvas.height / devicePixelRatio;
miasma.init(viewW, viewH);

// Simple baseline wind gear you can tune:
wind.clearGears();
// Example: constant wind to the left at 5 tiles/sec
wind.addGear({
  locked: true,
  dirDeg: 180,           // 180° = left
  speedTilesPerSec: 5,   // "5 knots"
  coverage: () => 1,     // affect whole screen for now
});

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

  // UPDATE — two records: move the world (camera), keep player on the spindle
  const a = axis();
  const speed = config.player.speed;
  const prevCamX = cam.x, prevCamY = cam.y;

  // Slide the land record under the spindle by moving the camera
  cam.x += a.x * speed * dt;
  cam.y += a.y * speed * dt;

  // Player "lives" at the camera center for drawing/aim
  player.x = cam.x;
  player.y = cam.y;

  // Stream chunks around world/camera center
  chunks.streamAround(cam.x, cam.y);

  // Compute view size once per frame
  const w = canvas.width / devicePixelRatio;
  const h = canvas.height / devicePixelRatio;

  // Real world motion for miasma conveyor
  const worldMotion = { x: cam.x - prevCamX, y: cam.y - prevCamY };
  miasma.update(dt, cam.x, cam.y, worldMotion, w, h);

  // Aim beam at mouse (player is screen center)

  const aimX = mouseX / devicePixelRatio - w / 2;
  const aimY = mouseY / devicePixelRatio - h / 2;
  beam.setAngle(Math.atan2(aimY, aimX));
  beam.raycast(player, beam.getAngle());



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
