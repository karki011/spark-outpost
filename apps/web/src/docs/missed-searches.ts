const KEY = 'spark-outpost.docs.missed-searches';
const MAX_ENTRIES = 30;
const MAX_QUERY_CHARS = 80;

export function missedSearches(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function recordMissedSearch(query: string): void {
  const text = query.trim().toLowerCase().slice(0, MAX_QUERY_CHARS);
  if (text.length < 3) return;
  const kept = missedSearches().filter((entry) => entry !== text && !text.startsWith(entry));
  try {
    localStorage.setItem(KEY, JSON.stringify([...kept, text].slice(-MAX_ENTRIES)));
  } catch {
    return;
  }
}
