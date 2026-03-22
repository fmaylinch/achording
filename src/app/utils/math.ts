export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function quantize(value: number, min: number, step: number): number {
  if (step <= 0) return value;

  const rounded = Math.round((value - min) / step) * step + min;
  const precision = Math.max(0, (step.toString().split("-")[1] || "").length);
  return Number(rounded.toFixed(precision));
}

export function roll(probabilityPercent: number): boolean {
  return Math.random() < clamp(probabilityPercent / 100, 0, 1);
}
