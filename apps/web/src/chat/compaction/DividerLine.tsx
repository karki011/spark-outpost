import './compaction.css';
import type { ReactNode } from 'react';
import type { AssistantTopic } from '@spark-outpost/contracts';
import { useMinuteClock } from '../../ui/use-minute-clock.ts';
import { topicLabel } from './topic-model.ts';

export function DividerLine({ children }: { children: ReactNode }) {
  return (
    <div className="compact-line">
      <span className="compact-rule" aria-hidden="true" />
      <span className="compact-label">{children}</span>
      <span className="compact-rule" aria-hidden="true" />
    </div>
  );
}

export function TopicDivider({ label }: { label: string }) {
  return (
    <div className="compact-divider topic-divider" role="separator" aria-label={label}>
      <DividerLine>{label}</DividerLine>
    </div>
  );
}

export function AssistantTopicDivider({ topic }: { topic: AssistantTopic }) {
  const now = useMinuteClock();
  return <TopicDivider label={topicLabel(topic, now)} />;
}
