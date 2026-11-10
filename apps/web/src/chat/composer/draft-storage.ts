const STORE_KEY = 'spark-outpost.drafts';
export const MAX_STORED_DRAFTS = 50;
export const MAX_STORED_DRAFT_CHARS = 20_000;

function readEntries(): [string, string][] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    return Object.entries(parsed).flatMap(([id, text]) =>
      typeof text === 'string' && text !== '' ? [[id, text] as [string, string]] : [],
    );
  } catch {
    return [];
  }
}

export function loadDrafts(): Map<string, string> {
  return new Map(readEntries());
}

export function storeDraft(conversationId: string, text: string): void {
  try {
    const others = readEntries().filter(([id]) => id !== conversationId);
    const next = text === '' ? others : [...others, [conversationId, clip(text)]];
    const kept = next.slice(-MAX_STORED_DRAFTS);
    if (kept.length === 0) localStorage.removeItem(STORE_KEY);
    else localStorage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    return;
  }
}

function clip(text: string): string {
  return text.length > MAX_STORED_DRAFT_CHARS ? text.slice(0, MAX_STORED_DRAFT_CHARS) : text;
}
