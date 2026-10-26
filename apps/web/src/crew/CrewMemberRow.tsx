import './crew-member-row.css';
import type { ReactNode } from 'react';
import { formatDuration } from '../audit/audit-model.ts';
import { formatTokens } from '../chat/composer/model-options.ts';
import { CostText } from '../usage/CostText.tsx';
import { CrewBlob } from './CrewBlob.tsx';
import { crewStateWord, type CrewAgent, type CrewState } from './crew-model.ts';

const TONES: Record<CrewState, string> = {
  inactive: 'pending',
  thinking: 'active',
  working: 'active',
  waiting: 'waiting',
  done: 'done',
  failed: 'failed',
  stopped: 'failed',
  queued: 'pending',
};

interface CrewMemberRowProps {
  agent: CrewAgent;
  job: string;
  blobSize?: number;
  children?: ReactNode;
}

export function CrewMemberRow({ agent, job, blobSize = 30, children }: CrewMemberRowProps) {
  return (
    <li className="crow" data-state={agent.state}>
      <CrewBlob
        name={agent.name}
        provider={agent.provider}
        state={agent.state}
        size={blobSize}
        blobId={agent.blobId}
      />
      <span className="nm">
        <b>
          {agent.name}
          <span className={`cst ${TONES[agent.state]}`}>{crewStateWord(agent.state)}</span>
        </b>
        <small title={job}>{job}</small>
      </span>
      <span className="num">
        {agent.tokens === null ? '—' : `${formatTokens(agent.tokens)} tok`}
        <small>
          {agent.state === 'queued' && agent.costUsd === null ? (
            'not started'
          ) : (
            <>
              <CostText usd={agent.costUsd} source={agent.costSource} empty="no cost" compact /> ·{' '}
              {formatDuration(agent.durationMs)}
            </>
          )}
        </small>
      </span>
      {children}
    </li>
  );
}
