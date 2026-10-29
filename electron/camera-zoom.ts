// scrcpy CameraCapture uses logarithmic increments (1 + 1/16), clamped by
// CONTROL_ZOOM_RATIO_RANGE. Endpoints are included even between increments.
export function cameraZoomSteps(min?: number, max?: number): number[] {
  if (min === undefined || max === undefined || !Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max < min || max / min > 10000) return []
  const values = [min], log = Math.log(1 + 1 / 16)
  for (let step = Math.ceil(Math.log(min) / log); step <= Math.floor(Math.log(max) / log); step++) {
    const value = Math.pow(1 + 1 / 16, step)
    if (value > min * 1.00001 && value < max / 1.00001) values.push(value)
  }
  if (max > min) values.push(max)
  return values
}
export function closestZoomIndex(values: number[], value: number) {
  return values.reduce((best, current, index) => Math.abs(Math.log(current / value)) < Math.abs(Math.log(values[best] / value)) ? index : best, 0)
}
