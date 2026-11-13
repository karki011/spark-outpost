import type { TeammateBrief } from '@spark-outpost/contracts';
import type { ProtocolObserver } from '../providers/provider.ts';
import type { RunInput } from './run-input.ts';

export const SPARK_HANDOFF_METHOD = 'spark/handoff';

export function auditSparkHandoff(
  audit: ProtocolObserver,
  input: Pick<RunInput, 'role' | 'mode' | 'provider' | 'settings' | 'workflowStep'>,
  brief: TeammateBrief | null,
): void {
  if (input.role !== 'spark') return;
  audit.message('harness', {
    method: SPARK_HANDOFF_METHOD,
    params: {
      spark: brief?.name ?? null,
      role: brief?.role ?? null,
      standingInstructions: brief ? brief.instructions.length > 0 : false,
      runsAs: input.workflowStep
        ? 'workflow step: commands follow its mode, no file changes'
        : 'read-only subagent with its own session',
      mode: input.mode,
      provider: input.provider,
      model: input.settings.model,
    },
  });
}
