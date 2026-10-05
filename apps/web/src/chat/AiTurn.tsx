import type { ReactNode } from 'react';
import type { AdviceSummary, Category } from '@spark-outpost/contracts';
import { AgentBlob } from '../brand/AgentBlob.tsx';
import type { BlobExpression } from '../brand/blob-expression.ts';
import { AdviceChip } from './AdviceChip.tsx';
import { jevLine } from './jev-line.ts';
import { followingLine } from './project/agent-setup.ts';
import { providerName } from './provider-name.ts';
import { useLiveHead } from './status/status-context.ts';

export type TurnState = 'working' | 'waiting' | 'done' | 'failed' | 'stopped';

const expressions: Record<TurnState, BlobExpression> = {
  working: 'thinking',
  waiting: 'unsure',
  done: 'happy',
  failed: 'sad',
  stopped: 'sleepy',
};

interface AiTurnProps {
  provider: string;
  label: string;
  state: TurnState;
  category?: Category | null | undefined;
  advice?: AdviceSummary | undefined;
  following?: readonly string[] | null | undefined;
  status?: ReactNode;
  liveId?: string | null;
  children: ReactNode;
}

export function AiTurn({
  provider,
  label,
  state,
  category,
  advice,
  following,
  status,
  liveId = null,
  children,
}: AiTurnProps) {
  const headRef = useLiveHead(liveId);
  const followed = followingLine(following ?? []);
  const jev = jevLine(advice);
  return (
    <div className="msg ai">
      <div className="ai-head" ref={headRef}>
        <span className={`ai-avatar ${state}`} aria-hidden="true">
          <AgentBlob
            provider={provider}
            size={30}
            expression={expressions[state]}
            animate={state === 'working' || state === 'waiting' ? 'always' : 'hover'}
          />
        </span>
        <span className="provider-name">{providerName(provider)}</span>
        <span className="mood">{label}</span>
        {status && (
          <>
            <span className="mood-dot" aria-hidden="true">
              ·
            </span>
            {status}
          </>
        )}
        <AdviceChip category={category} advice={advice} />
        {jev && (
          <span className="ai-jev" title={jev}>
            {jev}
          </span>
        )}
        {followed && (
          <span className="ai-following" title={followed}>
            {followed}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}
