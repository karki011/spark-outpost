import type { Card, Moment } from './island-model.ts';

export interface RestLine {
  kind: 'waiting' | 'done' | 'failed';
  key: string;
  text: string;
  more: number;
  chatId: string;
  card: Card | null;
}

function lastPart(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path;
}

function memberTitle(card: Card): string | null {
  const outpost = card.chat.outpost;
  return outpost ? `@${outpost.handle} needs you in ${outpost.name}` : null;
}

export function waitingTitle(card: Card): string {
  const { approval, chat } = card;
  if (card.kind === 'force') return 'Approve: force-push';
  if (card.kind === 'question') {
    return memberTitle(card) ?? `${chat.attention?.agentName ?? chat.title} has a question`;
  }
  if (approval?.payload.plan) return 'Plan ready to review';
  if (approval?.kind === 'execute' && approval.payload.command) {
    return `Approve: run ${approval.payload.command}`;
  }
  if (approval?.kind === 'edit') {
    const paths = approval.payload.paths;
    return paths.length === 1
      ? `Approve: change ${lastPart(paths[0]!)}`
      : `Approve: change ${paths.length} files`;
  }
  const member = memberTitle(card);
  if (member) return member;
  if (approval?.payload.checkpoint) return `${chat.title}: ready for you`;
  return `${chat.title} needs you`;
}

export interface RestLineInput {
  sparkFocused: boolean;
  cards: readonly Card[];
  moment: Moment | null;
  momentText: string | null;
}

export function restLine(input: RestLineInput): RestLine | null {
  if (input.sparkFocused) return null;
  const { moment, momentText, cards } = input;
  if (moment && momentText) {
    return {
      kind: moment.kind,
      key: `${moment.kind}:${moment.runId}`,
      text: momentText,
      more: 0,
      chatId: moment.chatId,
      card: null,
    };
  }
  const card = cards.find((candidate) => !candidate.loading);
  if (!card) return null;
  return {
    kind: 'waiting',
    key: `waiting:${card.approval?.id ?? card.chat.id}`,
    text: waitingTitle(card),
    more: cards.length - 1,
    chatId: card.chat.id,
    card,
  };
}

export function restLineTitle(line: RestLine): string {
  const action = line.kind === 'waiting' ? ' · Review' : '';
  const more = line.more > 0 ? ` · +${line.more} more` : '';
  return `${line.text}${action}${more}`;
}
