import type { TouchPoint, TouchProfile } from './touch-protocol.js'
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))
export function analog(x: number, y: number, deadzone = .18) {
  const length = Math.hypot(x, y)
  if (length <= deadzone) return [0, 0]
  const scale = Math.min(1, (length - deadzone) / (1 - deadzone)) / length
  return [x * scale, y * scale]
}
export class TouchEngine {
  held = new Set<string>()
  direct?: TouchPoint
  private look?: { x: number; y: number; last: number }
  private dx = 0
  private dy = 0
  private stickDown = false
  reset() { this.held.clear(); this.direct = undefined; this.look = undefined; this.dx = this.dy = 0; this.stickDown = false }
  move(x: number, y: number) { this.dx += x; this.dy += y }
  frame(profile: TouchProfile, width: number, height: number, pad: { axes: readonly number[]; buttons: readonly { pressed: boolean; value: number }[] } | null, locked: boolean, now: number, elapsed: number): TouchPoint[] {
    const active = (key: string) => !!key && (key.startsWith('Pad') ? !!pad?.buttons[Number(key.slice(3))] && (pad.buttons[Number(key.slice(3))].pressed || pad.buttons[Number(key.slice(3))].value > .25) : this.held.has(key))
    const points: TouchPoint[] = []
    const aspect = Math.min(width, height)
    profile.marks.forEach((m, id) => {
      if (m.kind === 'button') { if (m.bindings.some(active)) points.push({ id, x: m.x, y: m.y }); return }
      if (m.kind === 'stick') {
        let x = Number(active(m.bindings[3])) - Number(active(m.bindings[1])), y = Number(active(m.bindings[2])) - Number(active(m.bindings[0]))
        if (!x && !y && m.gamepad && pad) [x, y] = analog(pad.axes[0] || 0, pad.axes[1] || 0)
        const length = Math.hypot(x, y)
        if (length) { points.push({ id, x: clamp(m.x + (this.stickDown ? x / Math.max(1, length) * m.radius * aspect / width : 0), 0, 1), y: clamp(m.y + (this.stickDown ? y / Math.max(1, length) * m.radius * aspect / height : 0), 0, 1) }); this.stickDown = true }
        else this.stickDown = false
        return
      }
      let dx = locked ? this.dx : 0, dy = locked ? this.dy : 0
      if (m.gamepad && pad) { const [x, y] = analog(pad.axes[2] || 0, pad.axes[3] || 0); dx += x * Math.min(elapsed, 40) * .7; dy += y * Math.min(elapsed, 40) * .7 }
      if (dx || dy) {
        if (!this.look) { this.look = { x: m.x, y: m.y, last: now }; points.push({ id, x: m.x, y: m.y }); return }
        const x = this.look.x + dx * m.sensitivity / width, y = this.look.y + dy * m.sensitivity / height
        // Leave one frame without this finger before recentering, preserving all other touches.
        if (Math.hypot((x - m.x) * width, (y - m.y) * height) > m.radius * aspect || x < 0 || x > 1 || y < 0 || y > 1) { this.look = undefined; return }
        this.look = { x, y, last: now }
      }
      if (this.look && now - this.look.last < 100) points.push({ id, x: this.look.x, y: this.look.y }); else this.look = undefined
    })
    this.dx = this.dy = 0
    if (this.direct) points.push(this.direct)
    return points
  }
}
