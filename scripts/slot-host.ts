import { spawnSync } from 'node:child_process';
import type { ShardPlan } from './test-selection.ts';
import {
  decideSlot,
  describeVerdict,
  parseProcessTable,
  type ProcessRow,
  type SlotDecision,
  type SlotProcess,
} from './slot-processes.ts';

function run(command: string, args: string[]): string {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  return result.status === 0 ? result.stdout : '';
}

function processTable(): ProcessRow[] {
  return parseProcessTable(run('ps', ['-axww', '-o', 'pid=,ppid=,pgid=,command=']));
}

function listeningPids(port: number): number[] {
  return run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'])
    .split('\n')
    .filter(Boolean)
    .map(Number);
}

function workingFolder(pid: number): string | null {
  const line = run('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'])
    .split('\n')
    .find((entry) => entry.startsWith('n'));
  return line ? line.slice(1) : null;
}

function environmentHas(pid: number, entry: string): boolean {
  return run('ps', ['-E', '-ww', '-o', 'command=', '-p', String(pid)])
    .split(/\s+/)
    .includes(entry);
}

function slotProcesses(plan: ShardPlan, rows: readonly ProcessRow[]): SlotProcess[] {
  const found = new Map<number, SlotProcess>();
  for (const port of [plan.ports.stub, plan.ports.api, plan.ports.web]) {
    for (const pid of listeningPids(port)) found.set(pid, { pid, port, cwd: workingFolder(pid) });
  }
  const workers = rows.filter((row) => /src\/workflow\/main\.ts/.test(row.command));
  for (const worker of workers) {
    if (found.has(worker.pid) || !environmentHas(worker.pid, `API_PORT=${plan.ports.api}`))
      continue;
    found.set(worker.pid, { pid: worker.pid, port: null, cwd: workingFolder(worker.pid) });
  }
  return [...found.values()];
}

export function inspectSlot(plan: ShardPlan, root: string): SlotDecision {
  const rows = processTable();
  return decideSlot(slotProcesses(plan, rows), rows, root);
}

function groupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch {
    return false;
  }
}

function signalGroup(pgid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pgid, signal);
  } catch {
    return;
  }
}

async function waitForGroups(pgids: readonly number[], milliseconds: number): Promise<void> {
  const deadline = Date.now() + milliseconds;
  while (pgids.some(groupAlive) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

export async function stopGroups(pgids: readonly number[]): Promise<void> {
  for (const pgid of pgids) signalGroup(pgid, 'SIGTERM');
  await waitForGroups(pgids, 5_000);
  for (const pgid of pgids.filter(groupAlive)) signalGroup(pgid, 'SIGKILL');
  await waitForGroups(pgids, 2_000);
}

export async function stopLeftovers(plan: ShardPlan, decision: SlotDecision): Promise<void> {
  if (decision.stop.length === 0) return;
  console.log(`[slot ${plan.slot}] Stopping test servers left running by an earlier run here:`);
  for (const verdict of decision.stop) console.log(`  ${describeVerdict(verdict)}`);
  await stopGroups([...new Set(decision.stop.map((verdict) => verdict.pgid))]);
}

export function describeBlocked(plan: ShardPlan, decision: SlotDecision): string {
  const lines = decision.blocked.map((verdict) => {
    const owner =
      verdict.kind === 'running'
        ? 'a test run from this checkout is still using it'
        : 'not a leftover from this checkout';
    return `  ${describeVerdict(verdict)} — ${owner}`;
  });
  return [`Slot ${plan.slot} is in use, so nothing was started:`, ...lines].join('\n');
}
