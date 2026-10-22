import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { z } from 'zod';
import { CLAUDE_WAIT_TOOLS } from './claude-tools.ts';
import { objectFields } from './object-fields.ts';

export const EARLY_WAKE_MS = 90_000;

const responseSchema = z.object({
  scheduledFor: z.number().nonnegative(),
  stopped: z.boolean().optional(),
});

const SCHEDULED_TEXT = /^Next wakeup scheduled for [\d:]+ \(in (\d+)s\)/;

export interface WakeupChange {
  call: string;
  wakesAt: number | null;
  exact: boolean;
}

function fromText(rawOutput: unknown, now: number): number | null | undefined {
  if (typeof rawOutput !== 'string') return undefined;
  if (rawOutput.startsWith('Loop stopped') || rawOutput.startsWith('Wakeup not scheduled')) {
    return null;
  }
  const seconds = SCHEDULED_TEXT.exec(rawOutput)?.[1];
  return seconds === undefined ? undefined : now + Number(seconds) * 1000;
}

export function scheduledWakeup(update: SessionUpdate, now: number): WakeupChange | null {
  if (update.sessionUpdate !== 'tool_call_update') return null;
  const claudeCode = objectFields(objectFields(update._meta).claudeCode);
  if (!(CLAUDE_WAIT_TOOLS as readonly unknown[]).includes(claudeCode.toolName)) return null;
  const call = update.toolCallId;
  const response = responseSchema.safeParse(claudeCode.toolResponse);
  if (response.success) {
    const { scheduledFor, stopped } = response.data;
    const wakesAt = stopped === true || scheduledFor === 0 ? null : scheduledFor;
    return { call, wakesAt, exact: true };
  }
  const wakesAt = fromText(update.rawOutput, now);
  return wakesAt === undefined ? null : { call, wakesAt, exact: false };
}
