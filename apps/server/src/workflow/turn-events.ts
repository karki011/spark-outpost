import { TOOL_NAME_CHARS, type RunEvent, type StepMark } from '@spark-outpost/contracts';
import { THINKING_STEP } from '../agents/acp/session-updates.ts';
import { storableText } from '../audit/redact.ts';
import { shotAnchor } from '../persistence/browser-screenshots.ts';
import {
  createRedactionFilter,
  redactSecrets,
  type RedactionFilter,
} from '../audit/redact-stream.ts';
import { newId } from '../persistence/ids.ts';
import type { ProviderOutput } from '../providers/provider.ts';
import { runEvents } from './run-events.ts';
import { attributed } from './subagent-events.ts';
import { createSubagentProgress } from './subagent-progress.ts';
import { toolArguments, toolResult } from './tool-call-text.ts';

export interface TurnEventsOptions {
  append: (event: RunEvent) => Promise<unknown>;
  secretValues: readonly string[];
  replySoFar?: () => ReplySoFar;
  now?: () => number;
}

interface ReplySoFar {
  shown: string;
  held: number;
}

export interface TurnEvents {
  observe(output: ProviderOutput): Promise<void>;
  close(): Promise<void>;
}

interface OpenStep {
  calls: number;
  mark: StepMark;
}

const FILE_KINDS = new Set(['read', 'edit', 'delete', 'move']);
const TARGET_CHARS = 200;

function filePath(path: string | undefined): string | null {
  const trimmed = path?.trim() ?? '';
  return trimmed ? trimmed.slice(-TARGET_CHARS) : null;
}

interface KindOutput {
  toolKind?: string;
  toolName?: string;
  path?: string;
  callout?: string;
}

function calloutMark(callout: string | undefined, secretValues: readonly string[]): string | null {
  const shown = callout ? storableText(redactSecrets(callout, secretValues)).trim() : '';
  return shown ? shown.slice(0, TARGET_CHARS) : null;
}

function kindMark(output: KindOutput, secretValues: readonly string[]): StepMark {
  const named = output.toolName ? { toolName: output.toolName.slice(0, TOOL_NAME_CHARS) } : {};
  const callout = calloutMark(output.callout, secretValues);
  if (!output.toolKind) return { ...named, ...(callout ? { target: callout } : {}) };
  const path = FILE_KINDS.has(output.toolKind) ? filePath(output.path) : null;
  const target = path ?? callout;
  return {
    toolKind: output.toolKind.slice(0, 40),
    ...named,
    ...(target ? { target } : {}),
  };
}

function anchorMark(reply: ReplySoFar | undefined): StepMark {
  if (!reply) return {};
  const { textOffset, textBefore, textHeld } = shotAnchor(reply.shown, reply.held);
  return { textOffset, textBefore, textHeld };
}

interface Thought {
  id: string;
  redaction: RedactionFilter;
}

const stepKey = (name: string, subagent: string | undefined) =>
  subagent ? `${subagent}\u0000${name}` : name;

const owned = (event: RunEvent, subagent: string | undefined): RunEvent =>
  (subagent ? attributed(event, subagent) : null) ?? event;

export function createTurnEvents({
  append,
  secretValues,
  replySoFar,
  now = Date.now,
}: TurnEventsOptions): TurnEvents {
  const subagents = createSubagentProgress({
    storable: (text) => storableText(redactSecrets(text, secretValues)),
  });
  const openSteps = new Map<string, OpenStep>();
  const announced = new Map<string, string>();
  const openCalls = new Set<string>();
  const startedCalls = new Set<string>();
  let thought: Thought | null = null;

  const think = async (delta: string) => {
    if (!thought) {
      thought = { id: newId(), redaction: createRedactionFilter(secretValues) };
      for (const event of runEvents.reasoningStart(thought.id)) await append(event);
    }
    const clean = storableText(thought.redaction.push(delta));
    if (clean) await append(runEvents.reasoningContent(thought.id, clean));
  };

  const stopThinking = async () => {
    if (!thought) return;
    const { id, redaction } = thought;
    thought = null;
    const rest = storableText(redaction.finish());
    if (rest) await append(runEvents.reasoningContent(id, rest));
    await append(runEvents.reasoningMessageEnd(id));
    await append(runEvents.reasoningEnd(id));
  };

  const startStep = async (
    name: string,
    subagent?: string,
    waits?: boolean,
    kind: StepMark = {},
  ) => {
    const key = stepKey(name, subagent);
    const open = openSteps.get(key);
    if (open) {
      open.calls += 1;
      return;
    }
    const toolCallId = announced.get(name);
    announced.delete(name);
    const mark: StepMark = {
      ...(toolCallId ? { toolCallId } : {}),
      ...(waits ? { waits } : {}),
      ...kind,
    };
    openSteps.set(key, { calls: 1, mark });
    const anchor = subagent ? {} : anchorMark(replySoFar?.());
    await append(owned(runEvents.stepStarted(name, { ...mark, ...anchor }, now()), subagent));
  };

  const finishStep = async (name: string, subagent?: string, kind: StepMark = {}) => {
    if (name === THINKING_STEP && !subagent) await stopThinking();
    const key = stepKey(name, subagent);
    const open = openSteps.get(key);
    if (open && open.calls > 1) {
      open.calls -= 1;
      return;
    }
    if (!open) return;
    openSteps.delete(key);
    const finished = {
      ...open.mark,
      ...(kind.target && !open.mark.target ? { target: kind.target } : {}),
      ...(kind.toolName && !open.mark.toolName ? { toolName: kind.toolName } : {}),
    };
    await append(owned(runEvents.stepFinished(name, finished, now()), subagent));
  };

  const startCall = async (id: string, name: string, subagent?: string) => {
    if (openCalls.has(id)) return;
    openCalls.add(id);
    startedCalls.add(id);
    announced.set(name, id);
    await append(owned(runEvents.toolCallStart(id, name), subagent));
  };

  const endCall = async (id: string, input: unknown, secret: boolean) => {
    if (!openCalls.delete(id)) return;
    const args = toolArguments(input, secret, secretValues);
    if (args) await append(runEvents.toolCallArgs(id, args));
    await append(runEvents.toolCallEnd(id));
  };

  return {
    async observe(output) {
      if (output.kind === 'step_started') {
        await startStep(output.name, output.subagent, output.waits, kindMark(output, secretValues));
      }
      if (output.kind === 'step_finished') {
        await finishStep(output.name, output.subagent, kindMark(output, secretValues));
      }
      if (output.kind === 'file_focus') await append(runEvents.fileFocus(output));
      if (output.kind === 'thought_delta') await think(output.delta);
      if (output.kind === 'tool_started') {
        await startCall(output.id, output.name, output.subagent);
      }
      if (output.kind === 'tool_input') await endCall(output.id, output.input, output.secret);
      if (
        output.kind === 'tool_result' &&
        startedCalls.has(output.id) &&
        !openCalls.has(output.id)
      ) {
        const content = toolResult(output.output, output.secret, secretValues);
        await append(runEvents.toolCallResult(newId(), output.id, content));
      }
      for (const event of subagents.observe(output)) await append(event);
    },
    close: stopThinking,
  };
}
