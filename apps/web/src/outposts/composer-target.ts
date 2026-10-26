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
  toConversationId?: string;
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

export const EMPTY_HINT = 'Choose an agent or add a chat to send a message.';
export const NOBODY_HINT = 'No recipients selected. Restore a recipient or choose Post note.';

const HANDLE_IN_PROGRESS = /(?:^|[\s([{"'])@([a-z0-9-]*)$/i;
const MENTION = /(^|[\s([{"'])@([a-z0-9-]+)(?=[.,:;!?)\]}"']*(?:\s|$))/gi;

interface Destination {
  conversationId: string;
  handle: string;
}

export function uniqueLead(
  members: readonly { conversationId: string; archived: boolean }[],
  stories: readonly { leadConversationId: string | null }[],
): string | null {
  const leads = new Set(
    stories
      .map((story) => story.leadConversationId)
      .filter(
        (id): id is string =>
          id !== null && members.some((member) => !member.archived && member.conversationId === id),
      ),
  );
  return leads.size === 1 ? [...leads][0]! : null;
}

function unknownHandle(text: string, handles: readonly string[]): string | null {
  return (
    [...text.matchAll(MENTION)]
      .map((match) => (match[2] ?? '').toLowerCase())
      .find((handle) => handle !== 'all' && !handles.includes(handle)) ?? null
  );
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
  destination: Destination | null = null,
  note = false,
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
  if (note) {
    return {
      action: 'note',
      label: 'Post note',
      hint: 'Note only · No agent will reply.',
      to: [],
      body: trimmed,
      ready: trimmed !== '',
    };
  }
  const unknown = unknownHandle(text, handles);
  const blocked = (hint: string): ComposerTarget => ({
    action: 'request',
    label: 'Send message',
    hint,
    to: [],
    body: trimmed,
    ready: false,
  });
  if (unknown)
    return blocked(`No chat here is called @${unknown}. Choose a member or correct the handle.`);
  const explicit = asked(text, handles, []);
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
  if (explicit.length > 0)
    return blocked(skipped.length ? NOBODY_HINT : 'Add a message for the selected agents.');
  if (text.trim().match(/^@all(?:\s|$)/i)) return blocked(EMPTY_HINT);
  if (!destination) return blocked(EMPTY_HINT);
  return {
    action: 'request',
    label: 'Send message',
    hint: '',
    to: [destination.handle],
    toConversationId: destination.conversationId,
    body: trimmed,
    ready: trimmed !== '',
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
