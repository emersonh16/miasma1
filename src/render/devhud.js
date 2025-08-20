// src/render/devhud.js
import { config } from "../core/config.js";
import { worldToTile } from "../core/coords.js";

let fps = 0, last = performance.now(), frames = 0;

/**
 * Draws developer HUD overlay in screen-space.
 * Shows FPS, camera/player state, tile coords, wind, miasma origin.
 */
export function drawDevHUD(ctx, cam, player, mouse, miasma, wind, w, h) {
  if (!config.flags.devhud) return;

  // --- FPS counter ---
  frames++;
  const now = performance.now();
  if (now - last >= 1000) {
    fps = frames;
    frames = 0;
    last = now;
  }

  ctx.save();
  ctx.fillStyle = "#fff";
  ctx.font = "12px monospace";
  let y = 16;
  const line = (txt) => { ctx.fillText(txt, 8, y); y += 14; };

  line(`FPS: ${fps}`);
  line(`Cam: ${cam.x.toFixed(1)}, ${cam.y.toFixed(1)}`);
  line(`Player: ${player.x.toFixed(1)}, ${player.y.toFixed(1)}`);

  const [tx, ty] = worldToTile(player.x, player.y, miasma.getTileSize());
  line(`Tile: ${tx}, ${ty}`);

  const wv = wind.getVelocity({
    centerWX: cam.x, centerWY: cam.y,
    tileSize: miasma.getTileSize(), time: now / 1000
  });
  line(`Wind: ${wv.vxTilesPerSec.toFixed(2)}, ${wv.vyTilesPerSec.toFixed(2)} tiles/s`);

  const o = miasma.getOrigin();
  line(`Miasma: ox=${o.ox}, oy=${o.oy}`);

  ctx.restore();
}
