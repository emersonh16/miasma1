# World and Miasma Architecture Plan

This document outlines the proposed architecture for streaming world data and managing the dynamic miasma field. It focuses on deterministic chunking for world content and a rolling buffer for miasma that remains anchored to world space.

## High-Level Modules
- **world/chunks** – shared chunker for load/unload and budgets
- **world/store** – registry of loaded chunks (terrain, props, entities)
- **world/gen** – deterministic generators seeded per chunk
- **systems/miasma** – rolling field with wind and regrowth
- **core/coords** – helpers for world ↔ tile ↔ chunk conversions
- **core/events** – tiny pub/sub for enter/exit events

## World Chunking
- Single chunker serves all systems.
- Chunk size `C` tiles (e.g., 32×32) with tile size `T` pixels.
- Stream window: centered on the player's chunk with radius `R_view + R_buffer` (e.g., 5×5 window for 2+1 radius).
- Lifecycle:
  - `onNeed(chunkId)` → generate terrain, props, entities deterministically.
  - Store results in `world/store` keyed by `(cx, cy)`.
  - `onEvict(chunkId)` → free resources and return to pool.
- Events: `onEnterChunk` and `onExitChunk` allow systems to react without owning chunk logic.
- Budgets: `maxChunkGenPerFrame` and LRU unload after a grace period.

## Rolling Miasma Field
- Separate from world chunks; implemented as a ring buffer following the player.
- Field size `(VW + 2M) × (VH + 2M)` tiles (viewport plus margin).
- Anchored via a stable world-tile origin `(ox, oy)` that only shifts on tile boundaries.
- Conveyor updates:
  - When the player crosses a tile, scroll the buffer and edge-fill new rows/cols using deterministic `miasmaSeed(wx, wy, time)`.
  - Wind applies a fractional offset; when it exceeds ±1 tile, scroll in wind direction and edge-fill.
- APIs:
  - `sample(wx, wy)` → map world tile to buffer index.
  - `clearArea(wx, wy, r, amt)` → operate within buffer.
  - `update(dt, playerWX, playerWY, worldMotion)` → handle scrolling, edge-fill, and regrow.
  - `draw(ctx, cam, screen)` → render overlapping region with viewport.

## Coordination
- World chunker emits enter/exit events for entities and props; miasma ignores them.
- Miasma depends only on player position, time, and optional world noise for deterministic edge fill.
- Entities query fog state via `miasma.sample(wx, wy)`; no cross-writes.

## Data Ownership and Extension Points
- World owns terrain, collision, props, entity lists.
- Miasma owns density buffer, last-cleared metadata, wind offsets.
- New systems plug into `world/chunks` by registering generators and listening to enter/exit events.

## Coordinate Helpers
- Implement once in `core/coords`:
  - `worldToTile(wx, wy, T)`
  - `tileToChunk(tx, ty, C)`
  - `chunkToWorld(cx, cy, C, T)`
  - `mod(n, m)` handling negatives

## Performance Guardrails
- `maxChunkGenPerFrame = 1`
- `maxEdgeFillPerTick` for miasma scrolls
- `maxTilesUpdatedPerTick` for regrowth
- `maxDrawTilesPerFrame` clipped by viewport and density threshold
- Exceeding budgets defers work to the next frame to avoid hitches.

## Minimal Contracts
**World**
- `chunks.streamAround(wx, wy)` → queue create/evict, return active chunk IDs
- `store.getTile(wx, wy)` → `{ id, solid }`
- `store.iterEntitiesInAABB(ax, ay, bx, by)` → iterator

**Miasma**
- `miasma.update(dt, playerWX, playerWY, worldMotion)`
- `miasma.sample(wx, wy)` → `0..255`
- `miasma.clearArea(wx, wy, r, amt)` → count
- `miasma.draw(ctx, cam, w, h)`

## Visual Stitching
- World draws per chunk, skipping offscreen chunks.
- Miasma draws its buffer directly; margins keep edges offscreen.
- Buffer scroll occurs before draw when crossing tiles, preventing seams.

## Summary
A single deterministic chunker streams all world data, while the miasma operates as an independent rolling field anchored to world coordinates. Systems interact through minimal APIs and events, enabling easy extension and maintaining smooth performance.
