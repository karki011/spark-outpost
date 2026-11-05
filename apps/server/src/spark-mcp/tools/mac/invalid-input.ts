import { z } from 'zod';
import type { SparkToolContext } from '../../tool.ts';
import { macActTool } from './act.ts';
import { auditMac } from './context.ts';
import { macAppsTool, macReadTool } from './read.ts';

const MAC_INPUTS = new Map(
  [macAppsTool, macReadTool, macActTool].map((tool) => [tool.name, z.object(tool.input)]),
);

interface ToolCall {
  name: string;
  args: unknown;
}

function toolCall(body: unknown): ToolCall | null {
  const message = body as { method?: unknown; params?: { name?: unknown; arguments?: unknown } };
  if (message?.method !== 'tools/call' || typeof message.params?.name !== 'string') return null;
  return { name: message.params.name, args: message.params.arguments ?? {} };
}

export function auditInvalidMacCall(context: SparkToolContext, body: unknown): void {
  const call = toolCall(body);
  const schema = call ? MAC_INPUTS.get(call.name) : undefined;
  if (!call || !schema || schema.safeParse(call.args).success) return;
  auditMac(context, {
    tool: call.name,
    action: 'invalid_input',
    app: null,
    decision: 'refused',
    detail: { reason: 'invalid_input' },
  });
}
