import type { ConversationSummary } from '@spark-outpost/contracts';
import { providerName } from '../chat/provider-name.ts';
import { relativeTime } from '../ui/relative-time.ts';
import type { SessionState } from './island-model.ts';
import { RunDots } from './island-parts.tsx';

function waitingChip(chat: ConversationSummary): string {
  if (chat.attention?.prFeedback) return 'PR feedback';
  return chat.attention?.kind === 'input' ? 'Has a question' : 'Waiting for you';
}

export function StateChip({ chat, state }: { chat: ConversationSummary; state: SessionState }) {
  switch (state) {
    case 'working':
      return (
        <span className="isl-schip run">
          <RunDots />
          Working
        </span>
      );
    case 'waiting':
      return <span className="isl-schip wait">{waitingChip(chat)}</span>;
    case 'failed':
      return <span className="isl-schip bad">Failed</span>;
    case 'done':
      return <span className="isl-schip">Done · {relativeTime(chat.updatedAt)}</span>;
    case 'idle':
      return <span className="isl-schip">{relativeTime(chat.updatedAt)}</span>;
  }
}

export function projectLine(chat: ConversationSummary, names: ReadonlyMap<string, string>): string {
  const project = chat.projectIds.map((id) => names.get(id)).find(Boolean) ?? 'No project';
  const provider = chat.latestRun?.provider;
  return provider ? `${project} · ${providerName(provider)}` : project;
}
