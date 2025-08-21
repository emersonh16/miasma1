import { iterEntitiesInAABB } from "../world/store.js";

export function makeEnemy(wx, wy, kind = "slime") {
  return { type: "enemy", kind, wx, wy, r: 12 };
}

export function updateEnemy(_e, _dt) {
  // does nothing for now
}

export function drawEnemy(ctx, cam, e) {
  ctx.save();
  ctx.translate(e.wx - cam.x, e.wy - cam.y);
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
