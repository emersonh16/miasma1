import { config } from "./config.js";
import { initInput } from "./input.js";
import { makeCamera, follow } from "./camera.js";
import * as miasma from "../systems/miasma/index.js";
import * as beam from "../systems/beam/index.js";
import { makePlayer, updatePlayer, drawPlayer } from "../entities/player.js";
import { clear } from "../render/draw.js";

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

// --- loop ---
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;

  // UPDATE
  updatePlayer(player, dt);
  miasma.update(dt);
  follow(cam, player);

  // DRAW
  const w = canvas.width / devicePixelRatio;
  const h = canvas.height / devicePixelRatio;
  clear(ctx, w, h);
  drawPlayer(ctx, cam, player);
  miasma.draw(ctx, cam, w, h);
  beam.draw(ctx, cam, player);

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Simple mode toggle via number keys (1/2/3)
addEventListener("keydown", (e) => {
  if (e.key === "1") beam.setMode("bubble");
  if (e.key === "2") beam.setMode("cone");
  if (e.key === "3") beam.setMode("laser");
});
