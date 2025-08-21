// --- Global session seed (changes every refresh/restart) ---
const SESSION_SEED = Math.floor(Math.random() * 1e9);

export const config = {
  seed: SESSION_SEED,   // <-- use this everywhere for deterministic RNG

  flags: { 
    miasma: true, 
    beam: true, 
    grid: true, 
    devhud: true 
  },

  // Beam tuning (all units in fog tiles; converted at runtime using miasma.tileSize)
  beam: {
    laser:  { steps: 24, stepTiles: 3, radiusTiles: 3, thicknessTiles: 0.75 },
    cone:   { steps: 10, stepTiles: 3, radiusTiles: 10 }, // half-width at far end
    bubble: { radiusTiles: 20 }
  },

  // World budgets
  maxChunkGenPerFrame: 1,
  maxDrawCalls: 2000,

  miasma: {
    tileSize: 4,
    marginTiles: 8,
    color: "rgba(128,0,180,1)",

    // regrow tuning (slower creep, same short pause)
    regrowChance: 0.18,       // ↓ slower per-tile probability
    regrowSpeedFactor: 0.5,   // ↓ global multiplier
    regrowDelay: 0.6,         // keep short delay before start

    regrowPad: 6,
    regrowScanPad: 24,
    regrowBudget: 600,        // ↓ max holes healed per frame

    maxRegrowScanPerFrame: 6000,
    offscreenRegrowPad: 48,
    offscreenForgetPad: 96,

    maxTilesUpdatedPerTick: 12000,
    maxDrawTilesPerFrame: 20000,

    clearedTTL: 0,
  },

  // Fallbacks still used by code if miasma.* not present
  maxEdgeFillPerTick: 128,
  maxTilesUpdatedPerTick: 256,
  maxDrawTilesPerFrame: 4096,

  player: { speed: 140 },
};
