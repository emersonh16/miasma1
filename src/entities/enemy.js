import { iterEntitiesInAABB } from "../world/store.js";

// --- Enemy factory ---
export function makeEnemy(wx, wy, kind = "slime") {
  return {
    type: "enemy",
    kind,
    wx, wy,
    r: 12,
    hp: 3,
    // simple brain + motion
    vx: 0, vy: 0,
    speed: 80,       // px/sec base speed
    _t: 0            // internal timer for wobble
  };
}

// --- Enemy update (chase player with a little wobble) ---
export function updateEnemy(e, dt, player) {
  if (!e || e.type !== "enemy" || !player) return;

  e._t += dt;

  const dx = player.x - e.wx;
  const dy = player.y - e.wy;
  const dist = Math.hypot(dx, dy) || 1;

  const AGGRO = 600;   // start chasing if within this many px
  const STOP  = 10;    // don't jitter when basically on top

  let ux = 0, uy = 0;
  if (dist > STOP && dist < AGGRO) {
    ux = dx / dist;
    uy = dy / dist;
  }

  // wobble so they feel alive (boogie woogie)
  const wob = 0.6;
  const wobX = Math.cos(e._t * 2.1) * wob;
  const wobY = Math.sin(e._t * 1.7) * wob;

  const s = e.speed;
  e.vx = (ux + wobX) * s;
  e.vy = (uy + wobY) * s;

  e.wx += e.vx * dt;
  e.wy += e.vy * dt;
}

function dot(ax, ay, bx, by) { return ax * bx + ay * by; }

/** Rotate (vx,vy) by -angle into beam space: +X = forward, +Y = left */
function toBeamSpace(vx, vy, angleRad) {
  const c = Math.cos(angleRad), s = Math.sin(angleRad);
  // rotate by -angle → [ c  s; -s  c ]
  const bx =  c * vx + s * vy;
  const by = -s * vx + c * vy;
  return { bx, by };
}

function hitBubble(px, py, e, radius) {
  const rr = radius + (e.r || 12);
  const dx = e.wx - px, dy = e.wy - py;
  return dx*dx + dy*dy <= rr*rr;
}

function hitCone(px, py, angleRad, e, len, halfAngleRad) {
  // enemy → beam space
  const { bx, by } = toBeamSpace(e.wx - px, e.wy - py, angleRad);
  if (bx < 0 || bx > len) return false;

  // cone half‑width at distance bx
  const edgeY = Math.tan(halfAngleRad) * bx;

  // inflate for enemy radius (so edges still feel like hits)
  const pad = (e.r || 12);
  return Math.abs(by) <= (edgeY + pad);
}

function hitLaser(px, py, angleRad, e, len, halfThickness) {
  const { bx, by } = toBeamSpace(e.wx - px, e.wy - py, angleRad);
  if (bx < 0 || bx > len) return false;
  return Math.abs(by) <= (halfThickness + (e.r || 12));
}



export function applyBeamDamage(player, angleRad, mode, params, cam, w, h) {
  const ax = cam.x - w / 2, ay = cam.y - h / 2;
  const bx = cam.x + w / 2, by = cam.y + h / 2;

  for (const e of iterEntitiesInAABB(ax, ay, bx, by)) {
    if (e.type !== "enemy") continue;

    let hit = false;
    if (mode === "bubble") {
      hit = hitBubble(player.x, player.y, e, params.bubbleRadius ?? 64);
    } else if (mode === "cone") {
      const half = (
        (params.coneHalfAngleDeg != null)
          ? params.coneHalfAngleDeg
          : (params.coneAngleTotalDeg ?? 64) * 0.5
      ) * Math.PI / 180;
      hit = hitCone(player.x, player.y, angleRad, e, params.coneLength ?? 224, half);
    } else if (mode === "laser") {
      hit = hitLaser(player.x, player.y, angleRad, e, params.laserLength ?? 384, (params.laserThickness ?? 8) * 0.5);
    }

    if (!hit) continue;

    e.hp = (e.hp ?? 3) - 1;
    if (e.hp <= 0) {
      e.type = "corpse";
      console.log(`💥 SLAYED: ${e.kind} at (${e.wx.toFixed(0)}, ${e.wy.toFixed(0)})`);
    }
  }
}


// --- Drawing ---
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
