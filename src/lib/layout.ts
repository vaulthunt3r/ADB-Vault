export const sidebarLimits = {
  left: { min: 176, max: 320, initial: 204 },
  right: { min: 260, max: 440, initial: 290 },
} as const

export function clampSidebarWidth(side: 'left' | 'right', width: unknown) {
  const { min, max, initial } = sidebarLimits[side]
  return typeof width === 'number' && Number.isFinite(width) ? Math.round(Math.min(max, Math.max(min, width))) : initial
}

export function fitSidebarWidths(windowWidth: number, left: number, right: number) {
  let excess = Math.max(0, left + right - Math.max(0, windowWidth - 420))
  const rightReduction = Math.min(excess, Math.max(0, right - sidebarLimits.right.min))
  right -= rightReduction
  excess -= rightReduction
  left -= Math.min(excess, Math.max(0, left - sidebarLimits.left.min))
  return { left, right }
}
