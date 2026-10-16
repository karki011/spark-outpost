const MAX_NAMES = 12;
const MAX_LENGTH = 60;

export type FocusNames = { ok: true; names: string[] } | { ok: false; problem: string };

function firstOfEach(names: readonly string[]): string[] {
  const seen = new Set<string>();
  return names.filter((name) => {
    const key = name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function parseFocusNames(text: string): FocusNames {
  const names = firstOfEach(
    text
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean),
  );
  if (names.length === 0) return { ok: false, problem: 'Add at least one name, such as Focus.' };
  if (names.length > MAX_NAMES) return { ok: false, problem: `Use at most ${MAX_NAMES} names.` };
  if (names.some((name) => name.length > MAX_LENGTH)) {
    return { ok: false, problem: `Keep each name to ${MAX_LENGTH} characters.` };
  }
  return { ok: true, names };
}
