export const config = {
  seed: 1337,
  flags: { miasma: true, beam: true, grid: true, devhud: true },

  // Beam tuning (all units in fog tiles; converted at runtime using miasma.tileSize)
  beam: {
    laser:  { steps: 24, stepTiles: 3, radiusTiles: 3, thicknessTiles: .75 },
    cone:   { steps: 10, stepTiles: 3, radiusTiles: 10 },        // half-width at far end
    bubble: { radiusTiles: 20 }
  },

  // World budgets
  maxChunkGenPerFrame: 1,
  maxDrawCalls: 2000,

   miasma: {
    // draw/tiling
    tileSize: 4,
    marginTiles: 8,
    color: "rgba(128,0,180,1)",

    // visual pizzaz (diagnostic: crank it up)
    shimmerAlpha: 0.45,  // was ~0.18 by default → make it obvious
    shimmerSpeed: 0.50,  // scale of wind influence on shimmer

    // regrow tuning
    regrowChance: 0.2,
    regrowPad: 6,
    regrowScanPad: 24,
    regrowBudget: 800,
    regrowDelay: 1.0,
    regrowSpeedFactor: 0.3,

    // legacy/budget caps used by our simple path as fallbacks
    maxEdgeFillPerTick: 3000,
    maxTilesUpdatedPerTick: 12000,
    maxDrawTilesPerFrame: 20000
  },


  // Fallbacks still used by code if miasma.* not present
  maxEdgeFillPerTick: 128,
  maxTilesUpdatedPerTick: 256,
  maxDrawTilesPerFrame: 4096,

  player: { speed: 140 },
};
