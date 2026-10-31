import { firstGenerationId, friendlyStep } from '@spark-outpost/contracts';
import type { ProviderOutput, SubagentReported } from '../../providers/provider.ts';
import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { startedTaskId } from './background-work.ts';
import { objectFields } from './object-fields.ts';
import { createUpdateMapper, type UpdateMapper } from './session-updates.ts';
import { withToolCalls } from './tool-call-outputs.ts';
import { createSubagentActivity, type SubagentActivity } from './subagent-activity.ts';
import type { Reported } from './subagent-report.ts';
import { shownTask, subagentMark } from './subagent-stream.ts';

export const SPAWN_STEP = friendlyStep('Agent');

type EndState = Extract<ProviderOutput, { kind: 'subagent_finished' }>['state'];

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
  takeSubagentTokens(): number;
}

interface Child {
  mapper: UpdateMapper;
  activity: SubagentActivity;
}

function reportOf(reported: Reported | undefined, message: string | null): SubagentReported | null {
  const { summary, ...usage } = reported ?? {};
  const report: SubagentReported = {
    ...(Object.keys(usage).length > 0 ? { usage } : {}),
    ...(summary ? { summary } : {}),
    ...(message ? { message } : {}),
  };
  return Object.keys(report).length > 0 ? report : null;
}

const CODEX_WAIT_TOOL = 'wait';
const CLAUDE_WAIT_TOOL = 'TaskOutput';

function waitsOn(update: SessionUpdate): boolean {
  if (update.sessionUpdate !== 'tool_call') return false;
  const meta = objectFields(update._meta);
  if (objectFields(objectFields(meta.codex).collaboration).tool === CODEX_WAIT_TOOL) return true;
  return objectFields(meta.claudeCode).toolName === CLAUDE_WAIT_TOOL;
}

function waiting(output: ProviderOutput): ProviderOutput {
  const step = output.kind === 'step_started' || output.kind === 'step_finished';
  return step && output.tool ? { ...output, waits: true } : output;
}

export function withSubagents(main: UpdateMapper, childMapper: () => UpdateMapper): TurnMapper {
  const working = new Map<string, Child>();
  const seen = new Set<string>();
  const names = new Map<string, string>();
  const waitCalls = new Set<string>();
  const tokens = new Map<string, number>();
  const taken = new Map<string, number>();
  const delivered = new Set<string>();
  const liveTasks = new Set<string>();
  const taskOwners = new Map<string, string>();
  const heldEnds = new Map<string, EndState>();

  const ownsLiveTask = (id: string): boolean => {
    const owner = firstGenerationId(id);
    return [...liveTasks].some((task) => taskOwners.get(task) === owner);
  };

  const finishedHeld = (
    shouldFinish: (id: string) => boolean,
    state: (held: EndState) => EndState = (held) => held,
  ): ProviderOutput[] => {
    const outputs: ProviderOutput[] = [];
    for (const [id, held] of heldEnds) {
      if (!shouldFinish(id)) continue;
      heldEnds.delete(id);
      outputs.push({ kind: 'subagent_finished', id, state: state(held) });
    }
    return outputs;
  };

  const reporting = (
    id: string,
    reported: Reported | undefined,
    message: string | null,
  ): ProviderOutput[] => {
    if (reported?.tokens !== undefined) tokens.set(firstGenerationId(id), reported.tokens);
    if (message) delivered.add(id);
    const kept = delivered.has(id) && reported ? { ...reported, summary: undefined } : reported;
    const report = reportOf(kept, message);
    return report ? [{ kind: 'subagent_report', id, report }] : [];
  };

  const mainOutputs = (update: SessionUpdate): ProviderOutput[] => {
    const tool =
      update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update';
    if (!tool) return main.map(update);
    if (waitsOn(update)) waitCalls.add(update.toolCallId);
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
    return child.mapper.finish(cancelled).map((output) => attribute(output, id));
  };

  return {
    ...main,
    map(update) {
      const mark = subagentMark(update);
      if (!mark) return mainOutputs(update);
      if (mark.event === 'task') {
        if (!mark.ended) {
          liveTasks.add(mark.id);
          return [];
        }
        liveTasks.delete(mark.id);
        return finishedHeld((id) => !ownsLiveTask(id));
      }
      if (mark.event === 'spawned') {
        if (seen.has(mark.id)) return [];
        seen.add(mark.id);
        const resumedAgent = firstGenerationId(mark.id);
        const ending = finishedHeld((id) => firstGenerationId(id) === resumedAgent);
        working.set(mark.id, { mapper: childMapper(), activity: createSubagentActivity() });
        const { id, name } = mark;
        const task = shownTask(mark.task, name);
        names.set(id, name);
        const parentId = mark.parentId !== null && seen.has(mark.parentId) ? mark.parentId : null;
        const started: ProviderOutput = { kind: 'subagent_started', id, parentId, name, task };
        if (parentId !== null) return [...ending, started];
        const spawning = main
          .clientAction(SPAWN_STEP)
          .map((output) =>
            'name' in output && output.name === SPAWN_STEP ? attribute(output, id) : output,
          );
        return [...ending, started, ...spawning];
      }
      if (mark.event === 'ended') {
        const ending = working.get(mark.id);
        if (!ending) return seen.has(mark.id) ? reporting(mark.id, mark.reported, null) : [];
        const closing = [
          ...close(mark.id, false),
          ...reporting(mark.id, mark.reported, ending.activity.lastMessage()),
        ];
        if (!ownsLiveTask(mark.id)) {
          return [...closing, { kind: 'subagent_finished', id: mark.id, state: mark.state }];
        }
        heldEnds.set(mark.id, mark.state);
        return closing;
      }
      const startedTask = startedTaskId(update);
      if (startedTask) taskOwners.set(startedTask, firstGenerationId(mark.id));
      const child = working.get(mark.id);
      if (!child) return [];
      const done = child.activity.see(update);
      if (update.sessionUpdate === 'agent_message_chunk') return [];
      const outputs = child.mapper.map(update).map((output) => attribute(output, mark.id));
      return done ? [...outputs, { kind: 'subagent_report', id: mark.id, report: done }] : outputs;
    },
    note(name, subagent) {
      const child = subagent ? working.get(subagent) : undefined;
      if (!child || !subagent) return main.note(name);
      return child.mapper.note(name).map((output) => attribute(output, subagent));
    },
    asker(sessionId) {
      const name = names.get(sessionId);
      return name === undefined ? null : { id: sessionId, name };
    },
    takeSubagentTokens() {
      let total = 0;
      for (const [id, count] of tokens) {
        total += Math.max(0, count - (taken.get(id) ?? 0));
        taken.set(id, count);
      }
      return total;
    },
    didWork: () => main.didWork() || seen.size > 0,
    finish(cancelled = false) {
      const children = [...working.keys()].flatMap((id) => close(id, cancelled));
      const held = finishedHeld(
        () => true,
        (state) => (cancelled ? 'cancelled' : state),
      );
      return [...children, ...held, ...main.finish(cancelled)];
    },
  };
}

export function createTurnMapper(agentName: string, checksWindow: boolean): TurnMapper {
  return withSubagents(withToolCalls(createUpdateMapper(agentName, checksWindow)), () =>
    withToolCalls(createUpdateMapper(agentName)),
  );
}
