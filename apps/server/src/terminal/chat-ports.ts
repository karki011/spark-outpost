export interface PortRoot {
  conversationId: string;
  pid: number;
  agentCli?: boolean;
}

export type ChatPortMap = Record<string, number[]>;

const NUMBER_PAIR = /^\s*(\d+)\s+(\d+)\s*$/;
const PANE_LINE = /^(\S+)\s+(\d+)\s*$/;
const PORT_TAIL = /:(\d{1,5})$/;
const MAX_PORT = 65_535;

export function childrenByParent(psOutput: string): Map<number, number[]> {
  const children = new Map<number, number[]>();
  for (const line of psOutput.split('\n')) {
    const match = NUMBER_PAIR.exec(line);
    if (!match) continue;
    const pid = Number(match[1]);
    const parent = Number(match[2]);
    const list = children.get(parent) ?? [];
    list.push(pid);
    children.set(parent, list);
  }
  return children;
}

export function descendantsOf(root: number, children: Map<number, number[]>): number[] {
  const seen = new Set<number>([root]);
  const queue = [root];
  while (queue.length > 0) {
    const pid = queue.shift()!;
    for (const child of children.get(pid) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      queue.push(child);
    }
  }
  return [...seen];
}

export function panePids(listPanesOutput: string): Map<string, number[]> {
  const panes = new Map<string, number[]>();
  for (const line of listPanesOutput.split('\n')) {
    const match = PANE_LINE.exec(line);
    if (!match) continue;
    const list = panes.get(match[1]!) ?? [];
    list.push(Number(match[2]));
    panes.set(match[1]!, list);
  }
  return panes;
}

export function listeningPorts(lsofOutput: string): Map<number, number[]> {
  const ports = new Map<number, number[]>();
  let pid: number | null = null;
  for (const line of lsofOutput.split('\n')) {
    if (line.startsWith('p')) {
      const parsed = Number(line.slice(1));
      pid = Number.isInteger(parsed) && parsed > 0 ? parsed : null;
      continue;
    }
    if (!line.startsWith('n') || pid === null) continue;
    const match = PORT_TAIL.exec(line);
    const port = match ? Number(match[1]) : 0;
    if (port < 1 || port > MAX_PORT) continue;
    const list = ports.get(pid) ?? [];
    list.push(port);
    ports.set(pid, list);
  }
  return ports;
}

export function portsByChat(
  roots: readonly PortRoot[],
  children: Map<number, number[]>,
  listening: Map<number, number[]>,
  excluded: ReadonlySet<number>,
): ChatPortMap {
  const found = new Map<string, Set<number>>();
  for (const root of roots) {
    for (const pid of descendantsOf(root.pid, children)) {
      if (root.agentCli && pid === root.pid) continue;
      for (const port of listening.get(pid) ?? []) {
        if (excluded.has(port)) continue;
        const set = found.get(root.conversationId) ?? new Set<number>();
        set.add(port);
        found.set(root.conversationId, set);
      }
    }
  }
  const map: ChatPortMap = {};
  for (const id of [...found.keys()].sort()) {
    map[id] = [...found.get(id)!].sort((a, b) => a - b);
  }
  return map;
}

export function samePortMap(a: ChatPortMap, b: ChatPortMap): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function postgresPort(databaseUrl: string): number | null {
  try {
    const url = new URL(databaseUrl);
    return url.port ? Number(url.port) : 5432;
  } catch {
    return null;
  }
}
