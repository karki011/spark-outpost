import type { ConversationSummary } from '@spark-outpost/contracts';
import { HomeLead, LeadGroup } from './HomeCards.tsx';
import type { NeedItem, RunItem } from './home-model.ts';
import { RunRows, WaitingRows } from './LeadRows.tsx';
import { groupByMode, type ModeInfo } from './mode-groups.ts';

interface BeforeLeadProps {
  waiting: readonly NeedItem[];
  running: readonly RunItem[];
  modes: ReadonlyMap<string, ModeInfo>;
  onOpen: (chat: ConversationSummary) => void;
}

export function BeforeLead({ waiting, running, modes, onOpen }: BeforeLeadProps) {
  const groups = groupByMode(running, (item) => modes.get(item.chat.id) ?? null);
  const sections = [
    { id: 'lead-asking', title: 'Will stop and ask', items: groups.asking },
    { id: 'lead-free', title: 'Runs without asking', items: groups.free },
    { id: 'lead-running', title: 'Running', items: groups.unknown },
  ].filter((section) => section.items.length > 0);
  return (
    <HomeLead id="home-lead-h" title="Before you go">
      {waiting.length > 0 && (
        <LeadGroup id="lead-waiting" title="Waiting on you">
          <WaitingRows label="Waiting on you" items={waiting} onOpen={onOpen} />
        </LeadGroup>
      )}
      {sections.map((section) => (
        <LeadGroup key={section.id} id={section.id} title={section.title}>
          <RunRows label={section.title} items={section.items} modes={modes} onOpen={onOpen} />
        </LeadGroup>
      ))}
    </HomeLead>
  );
}
