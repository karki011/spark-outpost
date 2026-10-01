import { formatCost } from '../usage/format.ts';

export interface FastChat {
  id: string;
  title: string;
  detail: string;
}

export interface FastState {
  waiting: readonly FastChat[];
  running: readonly FastChat[];
  spendToday: number | null;
}

export interface FastAnswer {
  text: string;
  chats: FastChat[];
}

const NEEDS = /\b(need|needs|waiting|blocked|approv\w*|anyone|anything for me|stuck on me)\b/i;
const RUNNING = /\b(running|working|busy|in progress|going on|happening|active)\b/i;
const SPEND = /\b(spend|spent|cost|costs|bill)\b/i;
const TODAY = /\btoday\b/i;
const SPECIFIC = /\b(how('?s| is)|status of|about)\b.+\b(chat|going)\b/i;

function list(chats: readonly FastChat[]): string {
  const names = chats.slice(0, 3).map((chat) => `“${chat.title}”`);
  const more = chats.length - names.length;
  if (more > 0) return `${names.join(', ')} and ${more} more`;
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]!;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function fastAnswer(question: string, state: FastState): FastAnswer | null {
  const text = question.trim();
  if (!text || SPECIFIC.test(text)) return null;
  if (SPEND.test(text)) {
    if (!TODAY.test(text) || state.spendToday === null) return null;
    return { text: `You’ve spent ${formatCost(state.spendToday)} today.`, chats: [] };
  }
  if (NEEDS.test(text)) {
    if (state.waiting.length === 0) return { text: 'Nothing needs you right now.', chats: [] };
    return {
      text: `${plural(state.waiting.length, 'chat needs', 'chats need')} you: ${list(state.waiting)}.`,
      chats: [...state.waiting],
    };
  }
  if (RUNNING.test(text)) {
    if (state.running.length === 0) return { text: 'Nothing is running right now.', chats: [] };
    return {
      text: `${plural(state.running.length, 'chat is', 'chats are')} running: ${list(state.running)}.`,
      chats: [...state.running],
    };
  }
  return null;
}
