import type { ConversationSummary } from '@spark-outpost/contracts';
import { HomeLead, LeadGroup } from './HomeCards.tsx';
import type { NeedItem, RunItem } from './home-model.ts';
import { RunRows, WaitingRows } from './LeadRows.tsx';

interface BeforeLeadProps {
  waiting: readonly NeedItem[];
  running: readonly RunItem[];
  onOpen: (chat: ConversationSummary) => void;
}

export function BeforeLead({ waiting, running, onOpen }: BeforeLeadProps) {
  return (
    <HomeLead id="home-lead-h" title="Before you go">
      {waiting.length > 0 && (
        <LeadGroup id="lead-waiting" title="Waiting on you">
          <WaitingRows label="Waiting on you" items={waiting} onOpen={onOpen} />
        </LeadGroup>
      )}
      {running.length > 0 && (
        <LeadGroup id="lead-running" title="Still working">
          <RunRows label="Still working" items={running} onOpen={onOpen} />
        </LeadGroup>
      )}
    </HomeLead>
  );
}
