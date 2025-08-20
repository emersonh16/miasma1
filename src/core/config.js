export const config = {
  seed: 1337,
  flags: { miasma: true, beam: true, grid: true },



  // World budgets
  maxChunkGenPerFrame: 1,
  maxDrawCalls: 2000,

 miasma: {
   tileSize: 4,
   marginTiles: 4,

   // regrow tuning
   regrowChance: 0.7,       // ↑ higher = fewer gaps (set lower for more voids)
   regrowPad: 8,            // tiles outside viewport to scan
   regrowBudget: 400,       // tiles per frame allowed to regrow

   maxEdgeFillPerTick: 3000,
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