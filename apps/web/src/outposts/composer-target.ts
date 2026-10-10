import { addressees, userAddress } from '@spark-outpost/contracts';

type ComposerAction = 'request' | 'note' | 'answer';

export interface Answering {
  postId: string;
  conversationId: string;
  handle: string;
}

export interface ComposerTarget {
  action: ComposerAction;
  label: string;
  hint: string;
  to: string[];
  body: string;
  ready: boolean;
}

export interface HandleQuery {
  query: string;
  start: number;
}

export interface Filled {
  text: string;
  caret: number;
}

export const EMPTY_HINT = '@ a chat anywhere to ask it for work. Without a handle, it is a note.';
export const NOBODY_HINT = 'Asks nobody. This posts as a note.';

const LEADING_WORD = /^@([a-z0-9-]+)/i;
const HANDLE_IN_PROGRESS = /(?:^|[\s([{"'])@([a-z0-9-]*)$/i;

function unknownHandle(text: string, handles: readonly string[]): string | null {
  const word = LEADING_WORD.exec(text.trim())?.[1]?.toLowerCase();
  if (!word || word === 'all' || handles.includes(word)) return null;
  return word;
}

function noteHint(text: string, handles: readonly string[], skipped: readonly string[]): string {
  if (text.trim() === '') return EMPTY_HINT;
  if (asked(text, handles, []).length > 0 && skipped.length > 0) return NOBODY_HINT;
  const unknown = unknownHandle(text, handles);
  if (unknown) return `No chat here is called @${unknown}. This posts as a note.`;
  return 'A note starts no work.';
}

export function asked(
  text: string,
  handles: readonly string[],
  skipped: readonly string[],
): string[] {
  return addressees(text, handles).filter((handle) => !skipped.includes(handle));
}

export function composerTarget(
  text: string,
  handles: readonly string[],
  answering: Answering | null,
  skipped: readonly string[] = [],
): ComposerTarget {
  const trimmed = text.trim();
  if (answering) {
    return {
      action: 'answer',
      label: 'Send answer',
      hint: `Goes to @${answering.handle} as your message`,
      to: [answering.handle],
      body: trimmed,
      ready: trimmed !== '',
    };
  }
  const address = userAddress(text, handles, asked(text, handles, skipped));
  if (address.kind === 'request') {
    return {
      action: 'request',
      label: 'Send request',
      hint: '',
      to: address.to,
      body: address.body,
      ready: true,
    };
  }
  return {
    action: 'note',
    label: 'Post note',
    hint: noteHint(text, handles, skipped),
    to: [],
    body: address.body,
    ready: address.body !== '',
  };
}

export function handleQuery(text: string, caret: number = text.length): HandleQuery | null {
  const match = HANDLE_IN_PROGRESS.exec(text.slice(0, caret));
  if (!match) return null;
  const query = (match[1] ?? '').toLowerCase();
  return { query, start: caret - query.length - 1 };
}

export function matchingHandles<Member extends { handle: string }>(
  typing: HandleQuery | null,
  members: readonly Member[],
): Member[] {
  if (typing === null) return [];
  const matching = members.filter((member) => member.handle.startsWith(typing.query));
  const complete = matching.length === 1 && matching[0]?.handle === typing.query;
  return complete ? [] : matching;
}

export function withHandle(
  text: string,
  typing: HandleQuery,
  caret: number,
  handle: string,
): Filled {
  const before = `${text.slice(0, typing.start)}@${handle} `;
  return { text: before + text.slice(caret).replace(/^ /, ''), caret: before.length };
}
