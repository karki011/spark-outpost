import type { ConversationSummary } from '@spark-outpost/contracts';
import { terminalLabel } from '../terminal/native-state.ts';
import { providerName } from '../chat/provider-name.ts';
import { relativeTime } from '../ui/relative-time.ts';
import type { SessionState } from './island-model.ts';
import { RunDots } from './island-parts.tsx';

function terminalChangedAt(chat: ConversationSummary): string {
  const changed = chat.terminal?.updatedAt ?? chat.updatedAt;
  return changed > chat.updatedAt ? changed : chat.updatedAt;
}

function waitingChip(chat: ConversationSummary): string {
  if (chat.attention?.prFeedback) return 'PR feedback';
  return chat.attention?.kind === 'input' ? 'Has a question' : 'Waiting for you';
}

export function StateChip({
  chat,
  state,
  now,
}: {
  chat: ConversationSummary;
  state: SessionState;
  now?: number;
}) {
  if (chat.sessionType === 'terminal' && chat.terminal) {
    const style =
      state === 'waiting'
        ? ' wait'
        : state === 'working'
          ? ' run'
          : state === 'failed'
            ? ' bad'
            : '';
    const label =
      state === 'done'
        ? `Done · ${relativeTime(terminalChangedAt(chat), now)}`
        : terminalLabel(chat.terminal.state);
    return (
      <span className={`isl-schip${style}`}>
        Terminal<span className="sr-only"> session</span> · {label}
      </span>
    );
  }
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
      return <span className="isl-schip">Done · {relativeTime(chat.updatedAt, now)}</span>;
    case 'idle':
      return <span className="isl-schip">{relativeTime(chat.updatedAt, now)}</span>;
  }
}

export function projectLine(chat: ConversationSummary, names: ReadonlyMap<string, string>): string {
  const project = chat.projectIds.map((id) => names.get(id)).find(Boolean) ?? 'No project';
  const provider = chat.terminal?.provider ?? chat.latestRun?.provider;
  return provider ? `${project} · ${providerName(provider)}` : project;
}
