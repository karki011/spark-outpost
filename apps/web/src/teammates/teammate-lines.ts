import { TEAMMATE_STATE_LABELS, type TeammateView } from '@spark-outpost/contracts';
import { activeLabel } from '../conversations/recency.ts';

export function activityLine(teammate: TeammateView, now: number): string {
  const last = teammate.lastActivity;
  if (teammate.state !== 'idle') {
    const label = TEAMMATE_STATE_LABELS[teammate.state];
    return last ? `${label} · ${last.title}` : label;
  }
  if (!last) return 'No chats yet';
  return `${last.title} · ${activeLabel(last.at, now)}`;
}
