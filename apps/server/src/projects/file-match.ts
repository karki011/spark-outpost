function subsequenceGaps(needle: string, haystack: string): number | null {
  let position = -1;
  let gaps = 0;
  for (const char of needle) {
    const next = haystack.indexOf(char, position + 1);
    if (next === -1) return null;
    if (position !== -1) gaps += next - position - 1;
    position = next;
  }
  return gaps;
}

export function matchScore(query: string, filePath: string): number | null {
  const needle = query.trim().toLowerCase();
  if (needle === '') return 0;
  const lower = filePath.toLowerCase();
  const name = lower.slice(lower.lastIndexOf('/') + 1);
  if (name === needle) return 0;
  if (name.startsWith(needle)) return 1;
  if (name.includes(needle)) return 2;
  if (lower.includes(needle)) return 3;
  const gaps = subsequenceGaps(needle.replace(/\s+/g, ''), lower);
  return gaps === null ? null : 4 + gaps;
}

export function rankFiles(
  query: string,
  paths: readonly string[],
  limit: number,
): { paths: string[]; truncated: boolean } {
  const scored: { path: string; score: number }[] = [];
  for (const candidate of paths) {
    const score = matchScore(query, candidate);
    if (score !== null) scored.push({ path: candidate, score });
  }
  scored.sort(
    (a, b) => a.score - b.score || a.path.length - b.path.length || a.path.localeCompare(b.path),
  );
  return {
    paths: scored.slice(0, limit).map((entry) => entry.path),
    truncated: scored.length > limit,
  };
}
