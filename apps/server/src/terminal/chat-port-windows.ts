const PORT_TAIL = /:(\d{1,5})$/;
const LISTENING_FOREIGN = /^(?:0\.0\.0\.0|\[::\]|\*):(?:0|\*)$/;
const MAX_PORT = 65_535;

export function netstatListeners(
  netstatOutput: string,
  pids: readonly number[],
): Map<number, number[]> {
  const wanted = new Set(pids);
  const ports = new Map<number, number[]>();
  for (const line of netstatOutput.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length !== 5 || fields[0]!.toUpperCase() !== 'TCP') continue;
    const [, local, foreign, , pidText] = fields;
    if (!LISTENING_FOREIGN.test(foreign!)) continue;
    const pid = Number(pidText);
    const port = Number(PORT_TAIL.exec(local!)?.[1] ?? 0);
    if (!wanted.has(pid) || port < 1 || port > MAX_PORT) continue;
    const list = ports.get(pid) ?? [];
    if (!list.includes(port)) list.push(port);
    ports.set(pid, list);
  }
  return ports;
}

export function childrenFromRows(
  rows: ReadonlyArray<{ pid: number; ppid: number }>,
): Map<number, number[]> {
  const children = new Map<number, number[]>();
  for (const { pid, ppid } of rows) {
    if (pid === ppid) continue;
    const list = children.get(ppid) ?? [];
    list.push(pid);
    children.set(ppid, list);
  }
  return children;
}
