import {
  BACKGROUND_NAME_MAX,
  BACKGROUND_NAMES_SHOWN,
  EventType,
  OWN_SUBAGENT_METADATA,
  SUBAGENTS_ACTIVITY,
  SUBAGENT_REPORT,
  type BackgroundWait,
  type RunEvent,
  type SubagentReport,
} from '@spark-outpost/contracts';
import type { ProviderOutput } from '../providers/provider.ts';
import { runEvents } from './run-events.ts';

export interface SubagentProgress {
  observe(output: ProviderOutput): RunEvent[];
}

interface ProgressOptions {
  storable: (text: string) => string;
  now?: () => number;
}

const END_MESSAGES = { failed: 'The sub-agent failed.', cancelled: 'Stopped.' } as const;

export function createSubagentProgress({
  storable,
  now = Date.now,
}: ProgressOptions): SubagentProgress {
  const working = new Set<string>();
  let ownOpen = 0;
  let background: BackgroundWait | null = null;
  let shown = '';

  const lifecycle = (output: ProviderOutput): RunEvent[] => {
    if (output.kind === 'subagent_started') {
      if (working.has(output.id)) return [];
      working.add(output.id);
      const task = storable(output.task);
      return [
        {
          type: EventType.SUBAGENT_STARTED,
          subagentRunId: output.id,
          name: storable(output.name),
          ...(task ? { description: task } : {}),
          ...(output.parentId ? { parentSubagentRunId: output.parentId } : {}),
          timestamp: now(),
          metadata: OWN_SUBAGENT_METADATA,
        },
      ];
    }
    if (output.kind !== 'subagent_finished' || !working.delete(output.id)) return [];
    if (output.state === 'done') {
      return [
        {
          type: EventType.SUBAGENT_FINISHED,
          subagentRunId: output.id,
          outcome: { type: 'success' },
          timestamp: now(),
        },
      ];
    }
    return [
      {
        type: EventType.SUBAGENT_ERROR,
        subagentRunId: output.id,
        message: END_MESSAGES[output.state],
        code: output.state,
        timestamp: now(),
      },
    ];
  };

  const reported = (output: ProviderOutput): RunEvent[] => {
    if (output.kind !== 'subagent_report') return [];
    const { usage, files, commands, message, summary } = output.report;
    const { tokens, toolUses, durationMs, turns, model, costUsd } = usage ?? {};
    const shown = { tokens, toolUses, durationMs, turns, model, costUsd };
    const known = Object.fromEntries(
      Object.entries(shown).filter(([, value]) => value !== undefined),
    );
    const report: SubagentReport = {
      id: output.id,
      ...(Object.keys(known).length > 0 ? { usage: known } : {}),
      ...(files?.length ? { files } : {}),
      ...(commands?.length ? { commands: commands.map(storable) } : {}),
      ...(message ? { message: storable(message) } : {}),
      ...(summary ? { summary: storable(summary) } : {}),
    };
    return [{ type: EventType.CUSTOM, name: SUBAGENT_REPORT, value: report }];
  };

  const countOwn = (output: ProviderOutput) => {
    const own =
      (output.kind === 'step_started' || output.kind === 'step_finished') &&
      !output.subagent &&
      !output.waits;
    if (!own) return;
    ownOpen = output.kind === 'step_started' ? ownOpen + 1 : Math.max(0, ownOpen - 1);
  };

  const noteBackground = (output: ProviderOutput) => {
    if (output.kind !== 'background_work') return;
    const { agents, tasks } = output;
    const names = output.names
      .slice(0, BACKGROUND_NAMES_SHOWN)
      .map((name) => storable(name).slice(0, BACKGROUND_NAME_MAX));
    background = agents + tasks > 0 ? { agents, tasks, names } : null;
  };

  const wait = (): { waitingOn: number; background?: BackgroundWait } => {
    if (background) {
      const waitingOn = ownOpen > 0 ? 0 : background.agents + background.tasks;
      return { waitingOn, background };
    }
    return { waitingOn: ownOpen > 0 ? 0 : working.size };
  };

  return {
    observe(output) {
      const events = [...lifecycle(output), ...reported(output)];
      countOwn(output);
      noteBackground(output);
      const content = wait();
      const key = JSON.stringify(content);
      if (key === shown || (shown === '' && content.waitingOn === 0)) return events;
      shown = key;
      return [...events, runEvents.activity(SUBAGENTS_ACTIVITY, SUBAGENTS_ACTIVITY, content)];
    },
  };
}
