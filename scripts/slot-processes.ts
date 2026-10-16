import path from 'node:path';

export interface ProcessRow {
  pid: number;
  ppid: number;
  pgid: number;
  command: string;
}

export interface SlotProcess {
  pid: number;
  port: number | null;
  cwd: string | null;
}

export type SlotVerdict =
  | { kind: 'leftover'; process: SlotProcess; pgid: number; command: string }
  | { kind: 'running'; process: SlotProcess; command: string }
  | { kind: 'foreign'; process: SlotProcess; command: string };

const TEST_SERVER =
  /(tests\/browser\/provider-stub\.ts|src\/api\/main\.ts|src\/workflow\/main\.ts|vite\/bin\/vite\.js)/;
const PLAYWRIGHT_RUN = /playwright[^ ]*\/cli\.js test\b/;

export function checkoutFolders(root: string): string[] {
  return [root, path.join(root, 'apps/server'), path.join(root, 'apps/web')];
}

function ancestors(pid: number, table: ReadonlyMap<number, ProcessRow>): ProcessRow[] {
  const chain: ProcessRow[] = [];
  const seen = new Set<number>();
  let row = table.get(pid);
  while (row && row.pid > 1 && !seen.has(row.pid)) {
    seen.add(row.pid);
    chain.push(row);
    row = table.get(row.ppid);
  }
  return chain;
}

export function judgeSlotProcess(
  found: SlotProcess,
  rows: readonly ProcessRow[],
  root: string,
): SlotVerdict {
  const table = new Map(rows.map((row) => [row.pid, row]));
  const own = table.get(found.pid);
  const command = own?.command ?? '(gone)';
  const fromThisCheckout =
    own !== undefined &&
    TEST_SERVER.test(own.command) &&
    found.cwd !== null &&
    checkoutFolders(root).includes(found.cwd);
  if (!fromThisCheckout) return { kind: 'foreign', process: found, command };
  const chain = ancestors(found.pid, table);
  if (chain.some((row) => PLAYWRIGHT_RUN.test(row.command)) || own.pgid <= 1)
    return { kind: 'running', process: found, command };
  return { kind: 'leftover', process: found, pgid: own.pgid, command };
}

export interface SlotDecision {
  stop: Extract<SlotVerdict, { kind: 'leftover' }>[];
  blocked: Exclude<SlotVerdict, { kind: 'leftover' }>[];
}

export function decideSlot(
  found: readonly SlotProcess[],
  rows: readonly ProcessRow[],
  root: string,
): SlotDecision {
  const decision: SlotDecision = { stop: [], blocked: [] };
  for (const item of found) {
    const verdict = judgeSlotProcess(item, rows, root);
    if (verdict.kind === 'leftover') decision.stop.push(verdict);
    else decision.blocked.push(verdict);
  }
  return decision;
}

export function describeVerdict(verdict: SlotVerdict): string {
  const where = verdict.process.port === null ? 'no port' : `port ${verdict.process.port}`;
  const cwd = verdict.process.cwd ?? 'unknown folder';
  return `pid ${verdict.process.pid} (${where}, in ${cwd}): ${verdict.command}`;
}

export function parseProcessTable(output: string): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const line of output.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (!match) continue;
    rows.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      pgid: Number(match[3]),
      command: match[4]!,
    });
  }
  return rows;
}
