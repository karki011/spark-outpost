import './task-panes.css';
import { runRole, type RunStatus, type TaskRun } from '@spark-outpost/contracts';
import { AgentBlob } from '../brand/AgentBlob.tsx';
import { formatDuration } from '../audit/audit-model.ts';
import { formatTokens } from '../chat/composer/model-options.ts';
import { CostText } from '../usage/CostText.tsx';
import { CrewBlob } from '../crew/CrewBlob.tsx';
import {
  crewStateWord,
  modelLabel,
  roleLabel,
  type CrewAgent,
  type CrewState,
} from '../crew/crew-model.ts';

const statusWords: Record<RunStatus, { word: string; tone: string }> = {
  queued: { word: 'Queued', tone: 'pending' },
  running: { word: 'Working', tone: 'active' },
  awaiting_approval: { word: 'Waiting', tone: 'waiting' },
  succeeded: { word: 'Done', tone: 'done' },
  failed: { word: 'Failed', tone: 'failed' },
  cancelled: { word: 'Stopped', tone: 'failed' },
  outcome_unknown: { word: 'Unknown', tone: 'failed' },
};

export function crewNames(runs: readonly TaskRun[]): string[] {
  const seen = new Map<string, number>();
  return runs.map((run) => {
    const role = runRole(run.mode ?? null);
    const count = (seen.get(role) ?? 0) + 1;
    seen.set(role, count);
    return count > 1 ? `${role} ${count}` : role;
  });
}

const crewTones: Record<CrewState, string> = {
  thinking: 'active',
  working: 'active',
  waiting: 'waiting',
  done: 'done',
  failed: 'failed',
  stopped: 'failed',
  queued: 'pending',
};

function jobLine(agent: CrewAgent): string {
  return `${roleLabel(agent)} · ${modelLabel(agent)}`;
}

function OrchestratedCrew({ agents }: { agents: readonly CrewAgent[] }) {
  return (
    <div className="wsec">
      <div className="wsec-h">
        <h3>Crew</h3>
        <span className="r">
          {agents.length} {agents.length === 1 ? 'agent' : 'agents'}
        </span>
      </div>
      <ul className="tlist" aria-label="Crew">
        {agents.map((agent) => (
          <li key={agent.id} className="crow">
            <CrewBlob name={agent.name} provider={agent.provider} state={agent.state} size={30} />
            <span className="nm">
              <b>
                {agent.name}
                <span className={`cst ${crewTones[agent.state]}`}>
                  {crewStateWord(agent.state)}
                </span>
              </b>
              <small>{jobLine(agent)}</small>
            </span>
            <span className="num">
              {agent.tokens === null ? '—' : `${formatTokens(agent.tokens)} tok`}
              <small>
                {agent.state === 'queued' && agent.costUsd === null ? (
                  'not started'
                ) : (
                  <>
                    <CostText usd={agent.costUsd} source={agent.costSource} empty="no cost" /> ·{' '}
                    {formatDuration(agent.durationMs)}
                  </>
                )}
              </small>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface CrewPaneProps {
  runs: readonly TaskRun[];
  agents?: readonly CrewAgent[];
}

export function CrewPane({ runs, agents = [] }: CrewPaneProps) {
  if (agents.length > 0) return <OrchestratedCrew agents={agents} />;
  const names = crewNames(runs);
  return (
    <div className="wsec">
      <div className="wsec-h">
        <h3>Crew</h3>
        <span className="r">
          {runs.length} {runs.length === 1 ? 'agent' : 'agents'}
        </span>
      </div>
      <ul className="tlist" aria-label="Crew">
        {runs.map((run, index) => {
          const status = statusWords[run.status];
          return (
            <li key={run.id} className="crow">
              <AgentBlob provider={run.provider} size={30} />
              <span className="nm">
                <b>
                  {names[index]}
                  <span className={`cst ${status.tone}`}>{status.word}</span>
                </b>
                <small>
                  {[run.model ?? 'default model', run.effort].filter(Boolean).join(' · ')}
                </small>
              </span>
              <span className="num">
                {run.tokens === null ? '—' : `${formatTokens(run.tokens)} tok`}
                <small>
                  <CostText usd={run.costUsd} source={run.costSource} empty="no cost" /> ·{' '}
                  {formatDuration(run.durationMs ?? null)}
                </small>
              </span>
            </li>
          );
        })}
      </ul>
      <p className="wnote">
        One row per agent run. Roles come from the mode for now: Ask and Chat runs are Scouts, Do
        runs are Builders.
      </p>
    </div>
  );
}
