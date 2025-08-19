export function clear(ctx, w, h) {
  ctx.clearRect(0, 0, w, h);
  // Desert ground placeholder
  ctx.fillStyle = "#c9a66b";
  ctx.fillRect(0, 0, w, h);
}
