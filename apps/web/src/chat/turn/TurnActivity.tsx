import type { BackgroundWait, Run, SubagentRow } from '@spark-outpost/contracts';
import { modelOf } from '../../crew/chat-agent.ts';
import { BackgroundWork } from '../BackgroundWork.tsx';
import { SubagentsLine } from '../subagents/SubagentsLine.tsx';
import { WorkingLine } from './TurnParts.tsx';
import type { LeadStep } from './live-label.ts';

interface TurnActivityProps {
  run: Run;
  subagents: readonly SubagentRow[];
  working: boolean;
  waiting: boolean;
  background: BackgroundWait | null;
  lead: LeadStep;
}

export function TurnActivity({
  run,
  subagents,
  working,
  waiting,
  background,
  lead,
}: TurnActivityProps) {
  const running = working && !waiting;
  const agents = (
    <SubagentsLine runId={run.id} rows={subagents} live={working} leadModel={modelOf(run)} />
  );
  if (!running) return agents;
  return (
    <>
      {background ? (
        <BackgroundWork runId={run.id} background={background} />
      ) : (
        <WorkingLine run={run} step={lead} />
      )}
      {agents}
    </>
  );
}
