const NAMES_SHOWN = 2;

export function peopleLine(names: readonly string[], count: number): string | null {
  if (names.length === 0) return count > 1 ? `${count} people` : null;
  const shown = names.slice(0, NAMES_SHOWN);
  const rest = names.length - shown.length;
  if (rest > 0) return `${shown.join(', ')} +${rest} more`;
  return shown.join(' and ');
}
