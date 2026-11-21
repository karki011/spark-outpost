import './sub-chats.css';
import { useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import { providerIdSchema, shownChatTitle, type SubChatRow } from '@spark-outpost/contracts';
import { CAPABILITIES_STALE_MS, capabilitiesQuery } from '../../api/client.ts';
import { BranchIcon } from '../../ui/icons.tsx';
import { ReviewMarkdown } from '../markdown/ReviewMarkdown.tsx';
import { startedWithLine } from './started-with.ts';

function useStartedWith(row: SubChatRow | undefined, branch: string | null): string | null {
  const provider = providerIdSchema.safeParse(row?.startedWith.provider);
  const capabilities = useQuery({
    ...capabilitiesQuery(provider.success ? provider.data : 'claude'),
    staleTime: CAPABILITIES_STALE_MS,
    enabled: provider.success,
  });
  if (!row) return null;
  return startedWithLine(row.startedWith, capabilities.data, row.branch ?? branch);
}

interface TaskCardProps {
  parentTitle: string;
  task: string;
  row: SubChatRow | undefined;
  branch: string | null;
}

export function TaskCard({ parentTitle, task, row, branch }: TaskCardProps) {
  const headingId = useId();
  const startedWith = useStartedWith(row, branch);
  return (
    <section className="sc-card sc-task" aria-labelledby={headingId}>
      <header className="sc-card-h">
        <BranchIcon />
        <h3 id={headingId}>Task from {shownChatTitle(parentTitle)}</h3>
        <span className="sc-card-by">Started by that chat · not your message</span>
      </header>
      <div className="sc-card-b">
        <ReviewMarkdown text={task} />
      </div>
      {startedWith && <p className="sc-card-f">{startedWith}</p>}
    </section>
  );
}
