import { normalizeOwned } from './owned.ts';

export interface NeededFile {
  path: string;
  what: string;
}

export const NEEDS_RULE =
  'If a file you do not own must change, leave it to its owner: finish your own files and end your reply with one line per file, `Needs: <path> — <what must change>`.';

const NEEDS_LINE =
  /^[ \t]*(?:[-*][ \t]+)?Needs:[ \t]*`?([^\s`]+)`?[ \t]*(?:[—–:-]+[ \t]*)?(.*)$/gim;
const TRAILING_MARKS = /[:;,.]+$/;
const WHAT_LIMIT = 400;
const PATCH_LIMIT = 4_000;

export function neededFiles(reply: string): NeededFile[] {
  const found = new Map<string, NeededFile>();
  for (const match of reply.matchAll(NEEDS_LINE)) {
    const path = normalizeOwned(match[1]!.replace(TRAILING_MARKS, ''));
    if (!path || found.has(path)) continue;
    found.set(path, { path, what: match[2]!.trim().slice(0, WHAT_LIMIT) });
  }
  return [...found.values()];
}

export function needText(worker: string, need: NeededFile): string {
  const what = need.what || 'the change its piece depends on';
  return `${worker} needs \`${need.path}\` changed: ${what}`;
}

export function crossedText(worker: string, path: string, patch: string): string {
  const shown =
    patch.length > PATCH_LIMIT
      ? `${patch.slice(0, PATCH_LIMIT)}\n[cut at ${PATCH_LIMIT} characters]`
      : patch;
  return `${worker} changed \`${path}\`, which your piece owns. The change was kept. Check it fits your piece and change it if it does not. What it changed:\n\`\`\`diff\n${shown.trim()}\n\`\`\``;
}
