import type { Card } from './island-model.ts';

function lastPart(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path;
}

function memberTitle(card: Card): string | null {
  const outpost = card.chat.outpost;
  return outpost ? `@${outpost.handle} needs you in ${outpost.name}` : null;
}

function approveTitle(card: Card, what: string): string {
  const outpost = card.chat.outpost;
  return outpost ? `@${outpost.handle}: approve ${what}` : `Approve: ${what}`;
}

export function waitingTitle(card: Card): string {
  const { approval, chat } = card;
  if (card.kind === 'force') return approveTitle(card, 'force-push');
  if (card.kind === 'question') {
    return memberTitle(card) ?? `${chat.attention?.agentName ?? chat.title} has a question`;
  }
  if (approval?.payload.plan) return 'Plan ready to review';
  if (approval?.kind === 'execute' && approval.payload.command) {
    return approveTitle(card, `run ${approval.payload.command}`);
  }
  if (approval?.kind === 'edit') {
    const paths = approval.payload.paths;
    return approveTitle(
      card,
      paths.length === 1 ? `change ${lastPart(paths[0]!)}` : `change ${paths.length} files`,
    );
  }
  const member = memberTitle(card);
  if (member) return member;
  if (approval?.payload.checkpoint) return `${chat.title}: ready for you`;
  return `${chat.title} needs you`;
}
