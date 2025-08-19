export function mod(n, m) {
  return ((n % m) + m) % m;
}

export function worldToTile(wx, wy, T) {
  return [Math.floor(wx / T), Math.floor(wy / T)];
}

export function tileToChunk(tx, ty, C) {
  return [Math.floor(tx / C), Math.floor(ty / C)];
}

export function chunkToWorld(cx, cy, C, T) {
  return [cx * C * T, cy * C * T];
}
