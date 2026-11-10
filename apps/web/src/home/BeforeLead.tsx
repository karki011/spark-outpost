import type { ConversationSummary } from '@spark-outpost/contracts';
import { HomeLead, LeadGroup } from './HomeCards.tsx';
import type { NeedItem, RunItem } from './home-model.ts';
import { RunRows, WaitingRows } from './LeadRows.tsx';
import { groupRunning, type CapabilitiesByProvider } from './run-mode.ts';

interface BeforeLeadProps {
  waiting: readonly NeedItem[];
  running: readonly RunItem[];
  capabilities: CapabilitiesByProvider;
  onOpen: (chat: ConversationSummary) => void;
}

export function BeforeLead({ waiting, running, capabilities, onOpen }: BeforeLeadProps) {
  return (
    <HomeLead id="home-lead-h" title="Before you go">
      {waiting.length > 0 && (
        <LeadGroup id="lead-waiting" title="Waiting on you">
          <WaitingRows label="Waiting on you" items={waiting} onOpen={onOpen} />
        </LeadGroup>
      )}
      {groupRunning(running, capabilities).map((group) => (
        <LeadGroup key={group.key} id={`lead-running-${group.key}`} title={group.title}>
          <RunRows
            label={group.title}
            items={group.items}
            capabilities={capabilities}
            onOpen={onOpen}
          />
        </LeadGroup>
      ))}
    </HomeLead>
  );
}
