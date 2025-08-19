export function clear(ctx, w, h) {
  ctx.clearRect(0, 0, w, h);
  // Desert ground placeholder
  ctx.fillStyle = "#203021ff";
  ctx.fillRect(0, 0, w, h);
}
