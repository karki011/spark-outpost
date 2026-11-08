import type { SessionUpdate } from '@agentclientprotocol/sdk/unstable';
import { firstGenerationId } from '@spark-outpost/contracts';
import { z } from 'zod';
import { objectFields } from './object-fields.ts';
import { EARLY_WAKE_MS, scheduledWakeup } from './scheduled-wakeup.ts';
import { subagentMark } from './subagent-stream.ts';

export interface BackgroundCount {
  agents: number;
  tasks: number;
  names: string[];
  wakesAt?: number;
}

export interface BackgroundWork {
  see(update: SessionUpdate): void;
  cycleStarted(): void;
  count(): BackgroundCount;
  busy(): boolean;
}

const ORIGIN_KEY = '_claude/origin';
const originSchema = z.object({ kind: z.string().min(1) });

export function endsAgentCycle(update: SessionUpdate): boolean {
  if (update.sessionUpdate !== 'usage_update') return false;
  if (update.cost) return true;
  return originSchema.safeParse(objectFields(update._meta)[ORIGIN_KEY]).success;
}

export function startedTaskId(update: SessionUpdate): string | null {
  if (update.sessionUpdate !== 'tool_call_update') return null;
  const response = objectFields(objectFields(objectFields(update._meta).claudeCode).toolResponse);
  const id = response.backgroundTaskId ?? response.taskId;
  return typeof id === 'string' && id !== '' ? id : null;
}

export function createBackgroundWork(now: () => number = Date.now): BackgroundWork {
  const agents = new Set<string>();
  const tasks = new Set<string>();
  const owners = new Map<string, string>();
  const names = new Map<string, string>();
  let wakesAt: number | null = null;
  let exactCall: string | null = null;

  const noteWakeup = (update: SessionUpdate) => {
    const change = scheduledWakeup(update, now());
    if (!change || (!change.exact && change.call === exactCall)) return;
    if (change.exact) exactCall = change.call;
    wakesAt = change.wakesAt;
  };

  const count = (): BackgroundCount => {
    const busyAgents = new Set([...agents].map(firstGenerationId));
    const loose: string[] = [];
    for (const task of tasks) {
      const owner = owners.get(task);
      if (owner) busyAgents.add(owner);
      else loose.push(task);
    }
    const shown = [...busyAgents, ...loose].flatMap((id) => {
      const name = names.get(id);
      return name ? [name] : [];
    });
    const counted = { agents: busyAgents.size, tasks: loose.length, names: shown };
    return wakesAt === null ? counted : { ...counted, wakesAt };
  };

  return {
    see(update) {
      noteWakeup(update);
      const mark = subagentMark(update);
      if (!mark) return;
      if (mark.event === 'spawned') {
        agents.add(mark.id);
        if (!names.has(firstGenerationId(mark.id)))
          names.set(firstGenerationId(mark.id), mark.name);
      }
      if (mark.event === 'ended') agents.delete(mark.id);
      if (mark.event === 'task') {
        if (mark.ended) tasks.delete(mark.id);
        else tasks.add(mark.id);
        if (mark.name) names.set(mark.id, mark.name);
      }
      if (mark.event === 'update') {
        const task = startedTaskId(update);
        if (task) owners.set(task, firstGenerationId(mark.id));
      }
    },
    cycleStarted() {
      if (wakesAt !== null && now() >= wakesAt - EARLY_WAKE_MS) wakesAt = null;
    },
    count,
    busy() {
      const current = count();
      return current.agents + current.tasks > 0 || current.wakesAt !== undefined;
    },
  };
}
