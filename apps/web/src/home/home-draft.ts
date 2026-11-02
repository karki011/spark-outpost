import { newDraftId } from '../api/client.ts';

const HOME_DRAFT_KEY = 'spark-outpost.home-draft';
const DRAFT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readSaved(): string | null {
  try {
    const saved = localStorage.getItem(HOME_DRAFT_KEY);
    return saved && DRAFT_ID.test(saved) ? saved : null;
  } catch {
    return null;
  }
}

export function saveHomeDraftId(id: string): void {
  try {
    localStorage.setItem(HOME_DRAFT_KEY, id);
  } catch {
    return;
  }
}

export function readHomeDraftId(): string {
  const saved = readSaved();
  if (saved) return saved;
  const id = newDraftId();
  saveHomeDraftId(id);
  return id;
}
