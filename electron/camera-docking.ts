export interface Rectangle { x: number; y: number; width: number; height: number }
export function cameraPanelBounds(camera: Rectangle, panel: Rectangle, work: Rectangle): Rectangle {
  const gap = 8, width = Math.min(panel.width, work.width), height = Math.min(panel.height, work.height)
  const right = camera.x + camera.width + gap, left = camera.x - width - gap
  // Prefer the right side, then the left. On a full monitor, keep controls reachable.
  const x = right + width <= work.x + work.width ? right : left >= work.x ? left : work.x + work.width - width
  return { x: Math.round(Math.max(work.x, Math.min(x, work.x + work.width - width))), y: Math.round(Math.max(work.y, Math.min(camera.y, work.y + work.height - height))), width, height }
}
