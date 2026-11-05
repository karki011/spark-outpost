export const STOP_KEEPING_TERMINALS = { kind: 'service:stop', terminals: 'keep' } as const;

export function isKeepTerminalsStop(message: unknown): boolean {
  if (message === null || typeof message !== 'object') return false;
  const { kind, terminals } = message as { kind?: unknown; terminals?: unknown };
  return kind === STOP_KEEPING_TERMINALS.kind && terminals === STOP_KEEPING_TERMINALS.terminals;
}
