// src/world/biomes/index.js
// Bare-bones biomes: ground color toggle + randomize/cycle helpers.

// --- Registry: add/remove biomes here ---
export const BIOMES = {
  ice:        { name: "Ice Plateau",      ground: "#86dff0" },
  saltflats:  { name: "Salt Flats",       ground: "#f8f8f8" }, // near‑white, sun‑bleached
  volcanic:   { name: "Volcanic",         ground: "#2b0d0d" }, // deep, ashy maroon
  fungal:     { name: "Fungal Marsh",     ground: "#223322" }, // dark green‑gray
  crystal:    { name: "Crystal Desert",   ground: "#e7f5ff" }, // pale icy cyan
  tundra:     { name: "Frozen Plateau",   ground: "#e9f2f6" }, // soft blue‑white
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
