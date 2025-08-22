import { iterEntitiesInAABB, TILE_SIZE, CHUNK_SIZE, getChunk } from "../world/store.js";
import { worldToTile, tileToChunk } from "../core/coords.js";
import * as rocks from "../systems/rocks/index.js";

export function makeEnemy(x, y, kind = "slime") {
  return {
    type: "enemy",
    kind,
    x,
    y,
    r: 12,
    speed: 40,
    vx: 0,
    vy: 0,
    health: 3,
    maxHealth: 3,
  };
}

function removeEnemy(e) {
  const [tx, ty] = worldToTile(e.x, e.y, TILE_SIZE);
  const [cx, cy] = tileToChunk(tx, ty, CHUNK_SIZE);
  const chunk = getChunk(cx, cy);
  if (!chunk || !chunk.entities) return;
  const idx = chunk.entities.indexOf(e);
  if (idx !== -1) chunk.entities.splice(idx, 1);
}

export function updateEnemy(e, dt, player) {
  if (e.health != null && e.health <= 0) {
    removeEnemy(e);
    return;
  }

  // Chase the player
  const dx = player.x - e.x;
  const dy = player.y - e.y;
  const d = Math.hypot(dx, dy) || 1;
  e.vx = (dx / d) * e.speed;
  e.vy = (dy / d) * e.speed;

  const { x, y } = rocks.movePlayer(
    { x: e.x, y: e.y, r: e.r },
    e.vx * dt,
    e.vy * dt,
    e.r
  );
  e.x = x;
  e.y = y;

  // Player contact damage
  const pr = player.r ?? 0;
  const er = e.r ?? 0;
  const dist = Math.hypot(player.x - e.x, player.y - e.y);
  if (dist < pr + er) {
    // Apply simple contact damage (10 HP/sec default)
    const dmg = (e.damage ?? 10) * dt;
    if (player.health != null) {
      player.health -= dmg;
      if (player.health < 0) player.health = 0;
    }
  }
}

export function drawEnemy(ctx, cam, e) {
  ctx.save();
  ctx.translate(e.x - cam.x, e.y - cam.y);
  ctx.beginPath();
  ctx.arc(0, 0, e.r ?? 12, 0, Math.PI * 2);
  ctx.fillStyle = "#800080"; // purple blob
  ctx.fill();
  ctx.restore();
}

export function drawEnemies(ctx, cam, w, h) {
  const ax = cam.x - w / 2;
  const ay = cam.y - h / 2;
  const bx = cam.x + w / 2;
  const by = cam.y + h / 2;
  for (const e of iterEntitiesInAABB(ax, ay, bx, by)) {
    if (e.type === "enemy") drawEnemy(ctx, cam, e);
  }
}
