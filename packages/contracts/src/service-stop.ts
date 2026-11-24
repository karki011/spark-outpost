export const STOP_KEEPING_TERMINALS = { kind: 'service:stop', terminals: 'keep' } as const;
export const STOP_ENDING_TERMINALS = { kind: 'service:stop', terminals: 'end' } as const;

function stopWith(message: unknown, terminals: 'keep' | 'end'): boolean {
  if (message === null || typeof message !== 'object') return false;
  const { kind, terminals: asked } = message as { kind?: unknown; terminals?: unknown };
  return kind === 'service:stop' && asked === terminals;
}

export function isKeepTerminalsStop(message: unknown): boolean {
  return stopWith(message, 'keep');
}

export function isEndTerminalsStop(message: unknown): boolean {
  return stopWith(message, 'end');
}
