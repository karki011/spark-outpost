import { nameInParent } from '../conversations/sub-chat-tree.ts';
import type { Card } from './island-model.ts';

function lastPart(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path;
}

function approveTitle(what: string): string {
  return `Approve: ${what}`;
}

export function waitingTitle(card: Card): string {
  const { approval, chat } = card;
  if (card.kind === 'force') return approveTitle('force-push');
  if (card.kind === 'question') {
    return `${chat.attention?.agentName ?? chat.title} has a question`;
  }
  if (approval?.payload.plan) return 'Plan ready to review';
  if (approval?.kind === 'execute' && approval.payload.command) {
    return approveTitle(`run ${approval.payload.command}`);
  }
  if (approval?.kind === 'edit') {
    const paths = approval.payload.paths;
    return approveTitle(
      paths.length === 1 ? `change ${lastPart(paths[0]!)}` : `change ${paths.length} files`,
    );
  }
  if (approval?.payload.checkpoint) return `${chat.title}: ready for you`;
  return `${nameInParent(chat)} needs you`;
}
