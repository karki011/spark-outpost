import {
  agentRoleLabel,
  agentRoleSchema,
  type ConversationDetail,
  type ConversationSummary,
} from '@spark-outpost/contracts';
import type { Voice } from '../spark/voice.ts';
import { crewLine, type VoiceRole } from './crew-voice.ts';
import { isCheckStep } from './island-mood.ts';
import type { ChatAgent } from './use-island-data.ts';

export interface WorkItem {
  chat: ConversationSummary;
  agent: ChatAgent;
  detail: ConversationDetail | undefined;
}

export function roleLabel(role: string | null): string | null {
  const parsed = agentRoleSchema.safeParse(role);
  if (parsed.success) return agentRoleLabel(parsed.data);
  return role === 'jev' ? 'Planner' : null;
}

export function runStart(item: WorkItem): string | null {
  return item.detail?.runs.filter((run) => !run.parentRunId).at(-1)?.startedAt ?? null;
}

export function workLine(voice: Voice, item: WorkItem): string {
  const step = item.chat.latestRun?.step ?? item.agent.line ?? 'Working';
  return crewLine(voice, isCheckStep(step) ? 'checks' : 'working', {
    role: item.agent.role as VoiceRole | null,
    who: item.agent.name,
    fact: step,
    seed: item.chat.latestRun?.id ?? item.chat.id,
  });
}
