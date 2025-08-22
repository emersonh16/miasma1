// src/world/biomes/index.js
// Biomes: ground color toggle + randomize/cycle helpers.

// --- Registry: add/remove biomes here ---
export const BIOMES = {
  ice:        { name: "Ice Plateau",      ground: "#86dff0" },
  saltflats:  { name: "Salt Flats",       ground: "#f8f8f8" },
  volcanic:   { name: "Volcanic",         ground: "#2b0d0d" },
  lava:       { name: "Lava Wastes",      ground: "#2b0d0d" },
  swamp:      { name: "Swamp",            ground: "#223322" },
  crystal:    { name: "Crystal Desert",   ground: "#e7f5ff" },
  tundra:     { name: "Frozen Plateau",   ground: "#e9f2f6" },
  mountain:   { name: "Mountain Range",   ground: "#6b6b6b" },
  desert:     { name: "Desert",           ground: "#e3d6a3" },
  snow:       { name: "Snowfields",       ground: "#f3f7fb" },
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

// Rock color per biome (chosen for contrast vs ground)
export function getRockColor(id = _active) {
  switch (id) {
    case "ice":        return "#1f3b45";
    case "saltflats":  return "#5c5c5c";
    case "volcanic":   return "#a0452a";
    case "lava":       return "#b34a2e";
    case "swamp":      return "#7a8a7a";
    case "crystal":    return "#355a66";
    case "tundra":     return "#3f4f5a";
    case "mountain":   return "#202020";
    case "desert":     return "#6e5a2e";
    case "snow":       return "#3a4a58";
    default:           return "#555555";
  }
}

// --- Randomize biome for a run / reset ---
export function getBiomeIds() { return Object.keys(BIOMES); }

export function setRandomBiome() {
  const keys = Object.keys(BIOMES);
  if (!keys.length) return _active;
  _active = keys[(Math.random() * keys.length) | 0];
  return _active;
}
