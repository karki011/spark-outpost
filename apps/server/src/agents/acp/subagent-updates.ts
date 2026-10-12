import { friendlyStep } from '@spark-outpost/contracts';
import type { ProviderOutput } from '../../providers/provider.ts';
import { createUpdateMapper, type UpdateMapper } from './session-updates.ts';
import { withToolCalls } from './tool-call-outputs.ts';
import { subagentMark } from './subagent-stream.ts';

export const SPAWN_STEP = friendlyStep('Agent');

function attribute(output: ProviderOutput, subagent: string): ProviderOutput {
  switch (output.kind) {
    case 'step_started':
    case 'step_finished':
    case 'tool_started':
      return { ...output, subagent };
    default:
      return output;
  }
}

export function withSubagents(main: UpdateMapper, childMapper: () => UpdateMapper): UpdateMapper {
  const working = new Map<string, UpdateMapper>();
  const seen = new Set<string>();

  const close = (id: string, cancelled: boolean): ProviderOutput[] => {
    const child = working.get(id);
    if (!child) return [];
    working.delete(id);
    return child.finish(cancelled).map((output) => attribute(output, id));
  };

  return {
    ...main,
    map(update) {
      const mark = subagentMark(update);
      if (!mark) return main.map(update);
      if (mark.event === 'spawned') {
        if (seen.has(mark.id)) return [];
        seen.add(mark.id);
        working.set(mark.id, childMapper());
        const { id, name, task } = mark;
        const parentId = mark.parentId !== null && seen.has(mark.parentId) ? mark.parentId : null;
        const started: ProviderOutput = { kind: 'subagent_started', id, parentId, name, task };
        if (parentId !== null) return [started];
        const spawning = main
          .clientAction(SPAWN_STEP)
          .map((output) =>
            'name' in output && output.name === SPAWN_STEP ? attribute(output, id) : output,
          );
        return [started, ...spawning];
      }
      if (mark.event === 'ended') {
        if (!working.has(mark.id)) return [];
        return [
          ...close(mark.id, false),
          { kind: 'subagent_finished', id: mark.id, state: mark.state },
        ];
      }
      const child = working.get(mark.id);
      if (!child) return [];
      return child.map(update).map((output) => attribute(output, mark.id));
    },
    didWork: () => main.didWork() || seen.size > 0,
    finish(cancelled = false) {
      const children = [...working.keys()].flatMap((id) => close(id, cancelled));
      return [...children, ...main.finish(cancelled)];
    },
  };
}

export function createTurnMapper(agentName: string, checksWindow: boolean): UpdateMapper {
  return withSubagents(withToolCalls(createUpdateMapper(agentName, checksWindow)), () =>
    withToolCalls(createUpdateMapper(agentName)),
  );
}
