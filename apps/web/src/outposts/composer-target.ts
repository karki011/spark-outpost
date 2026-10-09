import { parseAddress } from '@spark-outpost/contracts';

type ComposerAction = 'request' | 'all' | 'note' | 'answer';

export interface Answering {
  postId: string;
  conversationId: string;
  handle: string;
}

export interface ComposerTarget {
  action: ComposerAction;
  label: string;
  hint: string;
  to: string | null;
  body: string;
  ready: boolean;
}

export const EMPTY_HINT = '@ a chat to ask it for work. Without a handle, it is a note.';

const LEADING_WORD = /^@([a-z0-9-]+)/i;
const HANDLE_IN_PROGRESS = /^@([a-z0-9-]*)$/i;

function unknownHandle(text: string, handles: readonly string[]): string | null {
  const word = LEADING_WORD.exec(text.trim())?.[1]?.toLowerCase();
  if (!word || word === 'all' || handles.includes(word)) return null;
  return word;
}

function noteHint(text: string, handles: readonly string[]): string {
  if (text.trim() === '') return EMPTY_HINT;
  const unknown = unknownHandle(text, handles);
  if (unknown) return `No chat here is called @${unknown}. This posts as a note.`;
  return 'A note starts no work.';
}

export function composerTarget(
  text: string,
  handles: readonly string[],
  answering: Answering | null,
): ComposerTarget {
  const trimmed = text.trim();
  if (answering) {
    return {
      action: 'answer',
      label: 'Send answer',
      hint: `Goes to @${answering.handle} as your message`,
      to: answering.handle,
      body: trimmed,
      ready: trimmed !== '',
    };
  }
  const address = parseAddress(text, handles);
  if (address.kind === 'request') {
    return {
      action: 'request',
      label: 'Send request',
      hint: `Starts a turn in @${address.to}`,
      to: address.to,
      body: address.body,
      ready: true,
    };
  }
  if (address.kind === 'all') {
    return {
      action: 'all',
      label: 'Send to all',
      hint: 'Starts a turn in every chat here',
      to: null,
      body: address.body,
      ready: true,
    };
  }
  return {
    action: 'note',
    label: 'Post note',
    hint: noteHint(text, handles),
    to: null,
    body: address.body,
    ready: address.body !== '',
  };
}

export function handleQuery(text: string): string | null {
  const match = HANDLE_IN_PROGRESS.exec(text);
  return match ? (match[1] ?? '').toLowerCase() : null;
}

export function matchingHandles<Member extends { handle: string }>(
  query: string | null,
  members: readonly Member[],
): Member[] {
  if (query === null) return [];
  return members.filter((member) => member.handle.startsWith(query));
}

export function withHandle(handle: string): string {
  return `@${handle} `;
}
