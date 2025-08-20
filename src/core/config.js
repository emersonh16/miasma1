export const config = {
  seed: 1337,
  flags: { miasma: true, beam: true },

  // World budgets
  maxChunkGenPerFrame: 1,
  maxDrawCalls: 2000,

  // Miasma tuning (new)
 miasma: {
  tileSize: 4,              // << super fine fog cells
  marginTiles: 4,
  maxEdgeFillPerTick: 3000, // bump budgets to keep up
  maxTilesUpdatedPerTick: 12000,
  maxDrawTilesPerFrame: 20000,
  color: "rgba(128,0,180,0.35)",
},



  // Fallbacks still used by code if miasma.* not present
  maxEdgeFillPerTick: 128,
  maxTilesUpdatedPerTick: 256,
  maxDrawTilesPerFrame: 4096,

  player: { speed: 140 },
};