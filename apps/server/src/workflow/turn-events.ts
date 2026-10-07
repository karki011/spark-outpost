import type { RunEvent, StepMark } from '@spark-outpost/contracts';
import { THINKING_STEP } from '../agents/acp/session-updates.ts';
import { storableText } from '../audit/redact.ts';
import { createRedactionFilter, type RedactionFilter } from '../audit/redact-stream.ts';
import { newId } from '../persistence/ids.ts';
import type { ProviderOutput } from '../providers/provider.ts';
import { runEvents } from './run-events.ts';
import { toolArguments, toolResult } from './tool-call-text.ts';

export interface TurnEventsOptions {
  append: (event: RunEvent) => Promise<unknown>;
  secretValues: readonly string[];
}

export interface TurnEvents {
  observe(output: ProviderOutput): Promise<void>;
  close(): Promise<void>;
}

interface OpenStep {
  calls: number;
  mark: StepMark;
}

interface Thought {
  id: string;
  redaction: RedactionFilter;
}

export function createTurnEvents({ append, secretValues }: TurnEventsOptions): TurnEvents {
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

  const startStep = async (name: string) => {
    const open = openSteps.get(name);
    if (open) {
      open.calls += 1;
      return;
    }
    const toolCallId = announced.get(name);
    announced.delete(name);
    const mark: StepMark = toolCallId ? { toolCallId } : {};
    openSteps.set(name, { calls: 1, mark });
    await append(runEvents.stepStarted(name, mark));
  };

  const finishStep = async (name: string) => {
    if (name === THINKING_STEP) await stopThinking();
    const open = openSteps.get(name);
    if (open && open.calls > 1) {
      open.calls -= 1;
      return;
    }
    if (!open) return;
    openSteps.delete(name);
    await append(runEvents.stepFinished(name, open.mark));
  };

  const startCall = async (id: string, name: string) => {
    if (openCalls.has(id)) return;
    openCalls.add(id);
    startedCalls.add(id);
    announced.set(name, id);
    await append(runEvents.toolCallStart(id, name));
  };

  const endCall = async (id: string, input: unknown, secret: boolean) => {
    if (!openCalls.delete(id)) return;
    const args = toolArguments(input, secret, secretValues);
    if (args) await append(runEvents.toolCallArgs(id, args));
    await append(runEvents.toolCallEnd(id));
  };

  return {
    async observe(output) {
      if (output.kind === 'step_started') await startStep(output.name);
      if (output.kind === 'step_finished') await finishStep(output.name);
      if (output.kind === 'file_focus') await append(runEvents.fileFocus(output));
      if (output.kind === 'thought_delta') await think(output.delta);
      if (output.kind === 'tool_started') await startCall(output.id, output.name);
      if (output.kind === 'tool_input') await endCall(output.id, output.input, output.secret);
      if (
        output.kind === 'tool_result' &&
        startedCalls.has(output.id) &&
        !openCalls.has(output.id)
      ) {
        const content = toolResult(output.output, output.secret, secretValues);
        await append(runEvents.toolCallResult(newId(), output.id, content));
      }
    },
    close: stopThinking,
  };
}
