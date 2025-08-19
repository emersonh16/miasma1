export const config = {
  seed: 1337,
  flags: { miasma: true, beam: true },

  // World budgets
  maxChunkGenPerFrame: 1,
  maxDrawCalls: 2000,

  // Miasma tuning (new)
  miasma: {
    tileSize: 16,             // try 16; go 8 if you want even finer
    marginTiles: 4,
    maxEdgeFillPerTick: 1500, // raise for small tiles
    maxTilesUpdatedPerTick: 6000,
    maxDrawTilesPerFrame: 14000,
    color: "rgba(128,0,180,0.35)",
  },

  // Fallbacks still used by code if miasma.* not present
  maxEdgeFillPerTick: 128,
  maxTilesUpdatedPerTick: 256,
  maxDrawTilesPerFrame: 4096,

  player: { speed: 140 },
};
