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
 
}
addEventListener("resize", resize);
resize();
initInput();

// Player motion vector for wind/coverage
let lastMotion = { x: 0, y: 0 };
const TILE_SIZE = config.miasma?.tileSize ?? 1;
const cam = makeCamera();
const player = makePlayer();
const viewW = canvas.width / devicePixelRatio;
const viewH = canvas.height / devicePixelRatio;
miasma.init(viewW, viewH, cam.x, cam.y); // center the ring on the spindle


// Wind gear that follows the player's movement
wind.clearGears();
// Disable wind for debugging (static fog)
wind.addGear({
  locked: true,
  dirDeg: 0,
  speedTilesPerSec: 0,
  coverage: () => 0,
});



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

  // Real world motion under camera (use camera delta; ring logic enqueues the correct edge)
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

  // Optional debug grid
  if (config.flags.grid) {
    drawGrid(ctx, cam, w, h, 64);
  }

  // World draw
  drawPlayer(ctx, cam, player);
  beam.draw(ctx, cam, player);

  ctx.restore();

  miasma.draw(ctx, cam, w, h);

  // --- DEBUG HUD: cam delta, wind, ring origin ---
  const wv = wind.getVelocity({ centerWX: cam.x, centerWY: cam.y, time: 0, tileSize: miasma.getTileSize() });
  const o = miasma.getOrigin();
  ctx.save();
  ctx.fillStyle = "#fff";
  ctx.font = "12px monospace";
  ctx.fillText(`camΔ: ${worldMotion.x.toFixed(2)}, ${worldMotion.y.toFixed(2)}`, 8, 16);
  ctx.fillText(`wind: ${wv.vxTilesPerSec.toFixed(2)}, ${wv.vyTilesPerSec.toFixed(2)} tiles/s`, 8, 32);
  ctx.fillText(`ring: ox=${o.ox}, oy=${o.oy}`, 8, 48);
  ctx.restore();

  requestAnimationFrame(frame);


}
requestAnimationFrame(frame);
