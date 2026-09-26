import { execFileSync } from 'node:child_process';

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function descendantsOf(
  root: number,
  table: ReadonlyArray<[pid: number, ppid: number]>,
): number[] {
  const children = new Map<number, number[]>();
  for (const [pid, ppid] of table) children.set(ppid, [...(children.get(ppid) ?? []), pid]);
  const found: number[] = [];
  const queue = [root];
  while (queue.length > 0) {
    for (const child of children.get(queue.shift()!) ?? []) {
      found.push(child);
      queue.push(child);
    }
  }
  return found;
}

function processTable(): Array<[number, number]> {
  try {
    return execFileSync('/bin/ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .map((line) => line.trim().split(/\s+/).map(Number) as [number, number]);
  } catch {
    return [];
  }
}

function signal(pid: number, name: NodeJS.Signals) {
  try {
    process.kill(pid, name);
  } catch {
    return;
  }
}

export function killProcessTree(root: number, graceMs = 1500): void {
  const targets = [root, ...descendantsOf(root, processTable())];
  for (const pid of targets) signal(pid, 'SIGHUP');
  signal(-root, 'SIGHUP');
  const escalate = setTimeout(() => {
    for (const pid of targets) if (isAlive(pid)) signal(pid, 'SIGKILL');
  }, graceMs);
  escalate.unref();
}
