import type { SessionUpdate, ToolCallContent } from '@agentclientprotocol/sdk';
import { mentionsSecretFile } from '../../audit/redact.ts';
import type { ProviderOutput } from '../../providers/provider.ts';
import type { UpdateMapper } from './session-updates.ts';
import { describeTool } from './tool-titles.ts';

interface OpenCall {
  input: unknown;
  inputSent: boolean;
  output: unknown;
  secret: boolean;
}

type ToolUpdate = Extract<SessionUpdate, { sessionUpdate: 'tool_call' | 'tool_call_update' }>;

function hasInput(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  return typeof value !== 'object' || Object.keys(value).length > 0;
}

function reported(content: readonly ToolCallContent[] | null | undefined, raw: unknown): unknown {
  const texts = (content ?? []).flatMap((item) =>
    item.type === 'content' && item.content.type === 'text' ? [item.content.text] : [],
  );
  return texts.length > 0 ? texts.join('\n') : (raw ?? null);
}

export interface ToolCallOutputs {
  map(update: SessionUpdate): ProviderOutput[];
  finish(): ProviderOutput[];
}

export function createToolCallOutputs(): ToolCallOutputs {
  const open = new Map<string, OpenCall>();

  const input = (id: string, call: OpenCall, force: boolean): ProviderOutput[] => {
    if (call.inputSent || (!force && !hasInput(call.input))) return [];
    call.inputSent = true;
    return [{ kind: 'tool_input', id, input: call.input ?? null, secret: call.secret }];
  };

  const close = (id: string): ProviderOutput[] => {
    const call = open.get(id);
    if (!call) return [];
    open.delete(id);
    return [
      ...input(id, call, true),
      { kind: 'tool_result', id, output: call.output, secret: call.secret },
    ];
  };

  const note = (call: OpenCall, update: ToolUpdate) => {
    if (hasInput(update.rawInput) && !call.inputSent) call.input = update.rawInput;
    call.secret ||= mentionsSecretFile(update.rawInput ?? null);
    call.secret ||= mentionsSecretFile(update.locations ?? null);
    call.output = reported(update.content, update.rawOutput) ?? call.output;
  };

  const ended = (update: ToolUpdate) => update.status === 'completed' || update.status === 'failed';

  return {
    map(update) {
      if (update.sessionUpdate === 'tool_call') {
        const outputs = close(update.toolCallId);
        const call: OpenCall = { input: null, inputSent: false, output: null, secret: false };
        open.set(update.toolCallId, call);
        note(call, update);
        outputs.push({
          kind: 'tool_started',
          id: update.toolCallId,
          name: describeTool(update.title, update.kind),
        });
        outputs.push(...input(update.toolCallId, call, false));
        if (ended(update)) outputs.push(...close(update.toolCallId));
        return outputs;
      }
      if (update.sessionUpdate !== 'tool_call_update') return [];
      const call = open.get(update.toolCallId);
      if (!call) return [];
      note(call, update);
      return ended(update) ? close(update.toolCallId) : input(update.toolCallId, call, false);
    },
    finish: () => [...open.keys()].flatMap(close),
  };
}

export function withToolCalls(mapper: UpdateMapper): UpdateMapper {
  const calls = createToolCallOutputs();
  return {
    ...mapper,
    map: (update) => [...calls.map(update), ...mapper.map(update)],
    finish: (cancelled = false) => [
      ...(cancelled ? [] : calls.finish()),
      ...mapper.finish(cancelled),
    ],
  };
}
