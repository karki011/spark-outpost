import type { BackgroundWait, Run, SubagentRow } from '@spark-outpost/contracts';
import { BackgroundWork } from '../BackgroundWork.tsx';
import type { CommandView } from '../commands/command-model.ts';
import { SubagentsLine } from '../subagents/SubagentsLine.tsx';
import { WorkingLine } from './TurnParts.tsx';
import { liveLabel } from './live-label.ts';

interface TurnActivityProps {
  run: Run;
  subagents: readonly SubagentRow[];
  working: boolean;
  waiting: boolean;
  background: BackgroundWait | null;
  commands: readonly CommandView[];
}

export function TurnActivity({
  run,
  subagents,
  working,
  waiting,
  background,
  commands,
}: TurnActivityProps) {
  const running = working && !waiting;
  const agents = <SubagentsLine runId={run.id} rows={subagents} live={working} />;
  if (!running) return agents;
  return (
    <>
      {background ? (
        <BackgroundWork runId={run.id} background={background} />
      ) : (
        <WorkingLine run={run} doing={liveLabel(subagents, commands)} />
      )}
      {agents}
    </>
  );
}
