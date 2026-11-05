export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((candidate) => candidate * power >= value) ?? 10;
  return step * power;
}

export function linear(domain: [number, number], range: [number, number]) {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  return (value: number) => r0 + ((value - d0) / span) * (r1 - r0);
}

export function movingAverage(values: readonly number[], window: number): number[] {
  return values.map((_, index) => {
    const start = Math.max(0, index - window + 1);
    const slice = values.slice(start, index + 1);
    return slice.reduce((sum, value) => sum + value, 0) / slice.length;
  });
}

export function smoothPath(points: readonly [number, number][]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M${points[0]![0]},${points[0]![1]}`;
  let path = `M${points[0]![0]},${points[0]![1]}`;
  for (let index = 1; index < points.length; index++) {
    const [x0, y0] = points[index - 1]!;
    const [x1, y1] = points[index]!;
    const middle = (x0 + x1) / 2;
    path += ` C${middle},${y0} ${middle},${y1} ${x1},${y1}`;
  }
  return path;
}
