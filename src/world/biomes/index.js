// src/world/biomes/index.js
// Bare-bones biomes: ground color toggle + randomize/cycle helpers.

// --- Registry: add/remove biomes here ---
export const BIOMES = {
  lava:      { name: "Lava Wastes",     ground: "#2b0d0d" },
  swamp:     { name: "Swamp",           ground: "#223322" },
  mountain:  { name: "Mountain Range",  ground: "#6b6b6b" },
  desert:    { name: "Desert",          ground: "#e3d6a3" },
  snow:      { name: "Snowfields",      ground: "#f3f7fb" },
};

// --- Active biome state ---
let _active = "saltflats";

// Set active biome by id (no throw; ignores unknown ids)
export function setBiome(id) {
  if (BIOMES[id]) _active = id;
  return _active;
}

// Getters
export function getBiomeId() { return _active; }
export function getBiome()   { return BIOMES[_active]; }

// Cycle through registered biomes (dir = +1 forward, -1 backward)
export function cycleBiome(dir = +1) {
  const keys = Object.keys(BIOMES);
  const i = Math.max(0, keys.indexOf(_active));
  const j = (i + (dir >= 0 ? 1 : -1) + keys.length) % keys.length;
  _active = keys[j];
  return _active;
}

// Ground color for current biome (fallback = neutral gray)
export function getGroundColor() {
  return BIOMES[_active]?.ground || "#4b4b4b";
}

// --- Randomize biome for a run / reset ---
export function getBiomeIds() { return Object.keys(BIOMES); }

export function setRandomBiome() {
  const keys = Object.keys(BIOMES);
  if (!keys.length) return _active;
  _active = keys[(Math.random() * keys.length) | 0];
  return _active;
}
