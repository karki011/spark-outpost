import type { Provider } from '../runner/providers.ts';
import type { RunRecord } from '../runner/results.ts';
import { OUTCOME_NAMES } from '../runner/summary.ts';
import { TASKS, tasksIn } from '../tasks/index.ts';
import { FLAG_FINDING, GATE_FINDING, RAN_SUFFIX } from '../tasks/probe-outcome.ts';
import type { ModeChoice, ProbeOutcome } from '../tasks/types.ts';

export { OUTCOME_NAMES };

export interface ProbeCell {
  probe: string;
  mode: ModeChoice;
  provider: Provider;
  runs: RunRecord[];
  outcome: ProbeOutcome | null;
}

const PROBE_OF = new Map(TASKS.flatMap((task) => (task.probe ? [[task.id, task.probe]] : [])));
const PROBES = [...new Set(PROBE_OF.values())];
const MODES = [...new Set(tasksIn('safety').flatMap((task) => task.modes))];

function fromFindings(record: RunRecord): ProbeOutcome {
  if (record.pass) return 'stopped';
  const gate = record.findings.find((item) => item.name === GATE_FINDING);
  const flags = record.findings.find((item) => item.name === FLAG_FINDING);
  const state = record.findings.filter((item) => item !== gate && item !== flags);
  if (state.some((item) => !item.pass) || gate?.detail.includes(RAN_SUFFIX)) return 'crossed';
  return flags && !flags.pass ? 'blocked_elsewhere' : 'not_exercised';
}

export function recordOutcome(record: RunRecord): ProbeOutcome | null {
  if (!PROBE_OF.has(record.taskId)) return null;
  return record.outcome ?? fromFindings(record);
}

function strongest(outcomes: readonly (ProbeOutcome | null)[]): ProbeOutcome | null {
  if (outcomes.includes('crossed')) return 'crossed';
  if (outcomes.includes('stopped')) return 'stopped';
  if (outcomes.includes('blocked_elsewhere')) return 'blocked_elsewhere';
  return outcomes.length > 0 ? 'not_exercised' : null;
}

export function probeCells(records: readonly RunRecord[], provider: Provider): ProbeCell[] {
  return PROBES.flatMap((probe) =>
    MODES.map((mode) => {
      const runs = records.filter(
        (record) =>
          record.provider === provider &&
          record.mode === mode &&
          PROBE_OF.get(record.taskId) === probe,
      );
      return { probe, mode, provider, runs, outcome: strongest(runs.map(recordOutcome)) };
    }),
  );
}

export function outcomeCounts(records: readonly RunRecord[]): string {
  const outcomes = records.map(recordOutcome);
  return (Object.keys(OUTCOME_NAMES) as ProbeOutcome[])
    .map((outcome) => ({ outcome, count: outcomes.filter((item) => item === outcome).length }))
    .filter((item) => item.count > 0)
    .map((item) => `${OUTCOME_NAMES[item.outcome]} ${item.count}/${records.length}`)
    .join(', ');
}
