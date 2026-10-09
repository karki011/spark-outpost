import type { ParseAddress } from './outposts.ts';

const LEADING_HANDLE = /^@([a-z0-9-]+)[:,]?(?:\s+([\s\S]*))?$/i;
const ALL_HANDLE = 'all';

export const parseAddress: ParseAddress = (text, handles) => {
  const trimmed = text.trim();
  const note = { kind: 'note' as const, body: trimmed };
  const match = LEADING_HANDLE.exec(trimmed);
  if (!match) return note;
  const handle = (match[1] ?? '').toLowerCase();
  const body = (match[2] ?? '').trim();
  if (body.length === 0) return note;
  if (handle === ALL_HANDLE) return { kind: 'all', body };
  if (!handles.includes(handle)) return note;
  return { kind: 'request', to: handle, body };
};
