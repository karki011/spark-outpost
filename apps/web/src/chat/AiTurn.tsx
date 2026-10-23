import type { ReactNode } from 'react';
import { AgentBlob } from '../brand/AgentBlob.tsx';
import type { BlobExpression } from '../brand/blob-expression.ts';
import { followingLine } from './project/agent-setup.ts';
import { providerName } from './provider-name.ts';
import { useLiveHead } from './status/status-context.ts';
import { useTurnFace, type TurnState } from './turn-face.ts';

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
  following?: readonly string[] | null | undefined;
  status?: ReactNode;
  liveId?: string | null;
  children: ReactNode;
}

export function AiTurn({
  provider,
  label,
  state,
  following,
  status,
  liveId = null,
  children,
}: AiTurnProps) {
  const headRef = useLiveHead(liveId);
  const own = useTurnFace();
  const followed = followingLine(following ?? []);
  return (
    <div className="msg ai">
      <div className="ai-head" ref={headRef}>
        <span className={`ai-avatar ${state}`} aria-hidden="true">
          {own ? (
            own.face(state)
          ) : (
            <AgentBlob
              provider={provider}
              size={30}
              expression={expressions[state]}
              animate={state === 'working' || state === 'waiting' ? 'always' : 'hover'}
            />
          )}
        </span>
        <span className="provider-name">{own?.name ?? providerName(provider)}</span>
        <span className="mood">{label}</span>
        {status && (
          <>
            <span className="mood-dot" aria-hidden="true">
              ·
            </span>
            {status}
          </>
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
