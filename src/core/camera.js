export function makeCamera() {
  return { x: 0, y: 0, zoom: 1 };
}
export function follow(cam, target, lerp = 0.15) {
  cam.x += (target.x - cam.x) * lerp;
  cam.y += (target.y - cam.y) * lerp;
}
