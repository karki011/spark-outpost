import { friendlyStep } from '@spark-outpost/contracts';
import type { ProviderOutput } from '../../providers/provider.ts';
import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { objectFields } from './object-fields.ts';
import { createUpdateMapper, type UpdateMapper } from './session-updates.ts';
import { withToolCalls } from './tool-call-outputs.ts';
import { shownTask, subagentMark } from './subagent-stream.ts';

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

export interface SubagentAsker {
  id: string;
  name: string;
}

export interface TurnMapper extends UpdateMapper {
  note(name: string, subagent?: string): ProviderOutput[];
  asker(sessionId: string): SubagentAsker | null;
}

const CODEX_WAIT_TOOL = 'wait';
const CLAUDE_WAIT_TOOL = 'TaskOutput';

function waitsOn(update: SessionUpdate, working: ReadonlyMap<string, unknown>): boolean {
  if (update.sessionUpdate !== 'tool_call') return false;
  const meta = objectFields(update._meta);
  if (objectFields(objectFields(meta.codex).collaboration).tool === CODEX_WAIT_TOOL) return true;
  if (objectFields(meta.claudeCode).toolName !== CLAUDE_WAIT_TOOL) return false;
  const taskId = objectFields(update.rawInput).task_id;
  if (typeof taskId !== 'string' || taskId === '') return false;
  return [...working.keys()].some((id) => id === taskId || id.startsWith(`${taskId}:generation:`));
}

function waiting(output: ProviderOutput): ProviderOutput {
  const step = output.kind === 'step_started' || output.kind === 'step_finished';
  return step && output.tool ? { ...output, waits: true } : output;
}

export function withSubagents(main: UpdateMapper, childMapper: () => UpdateMapper): TurnMapper {
  const working = new Map<string, UpdateMapper>();
  const seen = new Set<string>();
  const names = new Map<string, string>();
  const waitCalls = new Set<string>();

  const mainOutputs = (update: SessionUpdate): ProviderOutput[] => {
    const tool =
      update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update';
    if (!tool) return main.map(update);
    if (waitsOn(update, working)) waitCalls.add(update.toolCallId);
    const outputs = main.map(update);
    if (!waitCalls.has(update.toolCallId)) return outputs;
    if (update.status === 'completed' || update.status === 'failed') {
      waitCalls.delete(update.toolCallId);
    }
    return outputs.map(waiting);
  };

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
      if (!mark) return mainOutputs(update);
      if (mark.event === 'spawned') {
        if (seen.has(mark.id)) return [];
        seen.add(mark.id);
        working.set(mark.id, childMapper());
        const { id, name } = mark;
        const task = shownTask(mark.task, name);
        names.set(id, name);
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
    note(name, subagent) {
      const child = subagent ? working.get(subagent) : undefined;
      if (!child || !subagent) return main.note(name);
      return child.note(name).map((output) => attribute(output, subagent));
    },
    asker(sessionId) {
      const name = names.get(sessionId);
      return name === undefined ? null : { id: sessionId, name };
    },
    didWork: () => main.didWork() || seen.size > 0,
    finish(cancelled = false) {
      const children = [...working.keys()].flatMap((id) => close(id, cancelled));
      return [...children, ...main.finish(cancelled)];
    },
  };
}

export function createTurnMapper(agentName: string, checksWindow: boolean): TurnMapper {
  return withSubagents(withToolCalls(createUpdateMapper(agentName, checksWindow)), () =>
    withToolCalls(createUpdateMapper(agentName)),
  );
}
