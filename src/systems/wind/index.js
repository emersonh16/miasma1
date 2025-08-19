// Modular wind "gear train"
// - Each gear = { locked, dirDeg, speedTilesPerSec, coverage(wx,wy,ctx)->0..1 }
// - getVelocity(ctx) returns summed vx/vy in tiles/sec.

const gears = [];

/** Add a gear (returns its index) */
export function addGear(gear) {
  const g = {
    locked: true,
    dirDeg: 0,           // 0..360 (0 = +X/east)
    speedTilesPerSec: 0, // magnitude in tiles/sec
    coverage: () => 1,   // coverage mask over world, default full screen
    ...gear,
  };
  gears.push(g);
  return gears.length - 1;
}

export function clearGears() { gears.length = 0; }
export function setGearLocked(i, locked) { if (gears[i]) gears[i].locked = !!locked; }
export function setGear(i, patch) { if (gears[i]) Object.assign(gears[i], patch); }

/** Sum engaged gears → net velocity in tiles/sec */
export function getVelocity(ctx = {}) {
  let vx = 0, vy = 0;
  for (const g of gears) {
    if (!g.locked || g.speedTilesPerSec === 0) continue;
    const theta = (g.dirDeg * Math.PI) / 180;
    const wx = Math.cos(theta) * g.speedTilesPerSec;
    const wy = Math.sin(theta) * g.speedTilesPerSec;
    const w = Math.max(0, Math.min(1, g.coverage(ctx.centerWX ?? 0, ctx.centerWY ?? 0, ctx)));
    vx += wx * w;
    vy += wy * w;
  }
  return { vxTilesPerSec: vx, vyTilesPerSec: vy };
}
