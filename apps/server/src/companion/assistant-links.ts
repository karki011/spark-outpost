import {
  ASSISTANT_ANSWER_LINKS_MAX,
  SPARK_TOOL_STEPS,
  UNTITLED_CONVERSATION,
  parseChatReference,
  type AssistantChatLink,
} from '@spark-outpost/contracts';

export const LINKED_TITLE_MIN = 4;

const CHAT_READ_TOOL = /(?:^|[_.])spark_chat(?:_history)?$/;
const CHAT_READ_STEPS = new Set([SPARK_TOOL_STEPS.spark_chat, SPARK_TOOL_STEPS.spark_chat_history]);

function readsAChat(name: string): boolean {
  return CHAT_READ_TOOL.test(name) || CHAT_READ_STEPS.has(name);
}

export interface ToolEventRow {
  run_id: string;
  type: string;
  payload: { toolCallId?: unknown; toolCallName?: unknown; delta?: unknown };
}

function chatArgument(args: string): string | null {
  try {
    const parsed: unknown = JSON.parse(args);
    if (parsed === null || typeof parsed !== 'object') return null;
    const chat = (parsed as { chat?: unknown }).chat;
    return typeof chat === 'string' ? parseChatReference(chat) : null;
  } catch {
    return null;
  }
}

export function chatsReadByRun(events: readonly ToolEventRow[]): Map<string, string[]> {
  const chatCalls = new Set<string>();
  const args = new Map<string, { runId: string; text: string }>();
  for (const event of events) {
    const callId = event.payload.toolCallId;
    if (typeof callId !== 'string') continue;
    const key = `${event.run_id}:${callId}`;
    const name = event.payload.toolCallName;
    if (event.type === 'TOOL_CALL_START' && typeof name === 'string' && readsAChat(name)) {
      chatCalls.add(key);
    }
    const delta = event.payload.delta;
    if (event.type === 'TOOL_CALL_ARGS' && typeof delta === 'string') {
      const earlier = args.get(key)?.text ?? '';
      args.set(key, { runId: event.run_id, text: earlier + delta });
    }
  }
  const byRun = new Map<string, string[]>();
  for (const [key, { runId, text }] of args) {
    if (!chatCalls.has(key)) continue;
    const chat = chatArgument(text);
    if (!chat) continue;
    const chats = byRun.get(runId) ?? [];
    if (!chats.includes(chat)) chats.push(chat);
    byRun.set(runId, chats);
  }
  return byRun;
}

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function linkable(title: string): boolean {
  const trimmed = title.trim();
  return trimmed.length >= LINKED_TITLE_MIN && trimmed !== UNTITLED_CONVERSATION;
}

export function mentionedChats(
  answer: string,
  chats: readonly AssistantChatLink[],
): AssistantChatLink[] {
  const found: { link: AssistantChatLink; at: number }[] = [];
  const taken: [number, number][] = [];
  const longestFirst = chats
    .filter((chat) => linkable(chat.title))
    .toSorted((a, b) => b.title.length - a.title.length);
  for (const chat of longestFirst) {
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}])${escaped(chat.title.trim())}(?![\\p{L}\\p{N}])`,
      'giu',
    );
    const free = [...answer.matchAll(pattern)]
      .map((match): [number, number] => [match.index, match.index + match[0].length])
      .find(([start, end]) => !taken.some(([from, to]) => start < to && end > from));
    if (!free) continue;
    taken.push(free);
    found.push({ link: chat, at: free[0] });
  }
  return found
    .toSorted((a, b) => a.at - b.at)
    .slice(0, ASSISTANT_ANSWER_LINKS_MAX)
    .map((entry) => entry.link);
}
