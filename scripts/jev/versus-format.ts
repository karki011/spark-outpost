export const percent = (value: number | null) =>
  value === null ? '—' : `${Math.round(value * 100)}%`;
export const fixed = (value: number | null, digits = 2) =>
  value === null ? '—' : value.toFixed(digits);
export const whole = (value: number | null) => (value === null ? '—' : String(Math.round(value)));

export function table(head: readonly string[], body: readonly (readonly string[])[]): string {
  const line = (cells: readonly string[]) => `| ${cells.join(' | ')} |`;
  return [line(head), line(head.map(() => '---')), ...body.map(line)].join('\n');
}
