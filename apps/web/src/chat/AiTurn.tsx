import type { ReactNode } from 'react';
import type { Category } from '@spark-outpost/contracts';
import { AgentBlob } from '../brand/AgentBlob.tsx';
import type { BlobExpression } from '../brand/blob-expression.ts';
import { CategoryChip } from '../categories/CategoryChip.tsx';
import { providerName } from './provider-name.ts';

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
  children: ReactNode;
}

export function AiTurn({ provider, label, state, category, children }: AiTurnProps) {
  return (
    <div className="msg ai">
      <div className="ai-head">
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
        <CategoryChip category={category} />
      </div>
      {children}
    </div>
  );
}
