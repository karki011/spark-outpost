import { ticketSourceNames } from '@spark-outpost/contracts';
import type { RichTip, TipItem } from '../ui/Tooltip.tsx';
import { runStep } from '../chat/wait-label.ts';
import { pullBadge } from './row-links.ts';
import type { LiveTicket } from './ticket-flow.ts';
import { ageTitle } from './ticket-model.ts';
import { reportedText } from './ticket-status.ts';

const PRIORITY_NAMES = ['No priority', 'Urgent', 'High', 'Medium', 'Low'];

export function rowPreview({ ticket, line, chat }: LiveTicket, now: number): RichTip {
  const items: TipItem[] = [
    { label: 'Now', text: line },
    { label: 'Status', text: `${ticket.statusName} in ${ticketSourceNames[ticket.source]}` },
  ];
  if (ticket.chat) {
    const step = chat?.latestRun?.status === 'running' ? runStep(chat.latestRun) : null;
    items.push({ label: 'Chat', text: [ticket.chat.title, step].filter(Boolean).join(' · ') });
  }
  if (ticket.pullRequest) {
    const pull = ticket.pullRequest;
    items.push({ label: 'PR', text: `#${pull.number} in ${pull.repo} · ${pullBadge(pull).label}` });
  }
  const why = ticket.flags.map((flag) => flag.text).filter((text) => text !== line);
  if (why.length > 0) items.push({ label: 'Also', text: why.join(' · ') });
  items.push({
    label: 'Priority',
    text: PRIORITY_NAMES[ticket.priorityRank] ?? 'No priority',
  });
  if (ticket.age) items.push({ label: 'Age', text: ageTitle(ticket.age, now) });
  items.push({ label: 'Assignee', text: ticket.assignedTo?.name ?? 'Unassigned' });
  const reported = reportedText(ticket, now);
  if (reported) items.push({ label: 'Reported', text: reported });
  return { lead: `${ticket.key} · ${ticket.title}`, items };
}
