export const RUN_SIGNAL_CHANNEL = 'run_signals';
export const RUN_SIGNAL_FALLBACK_MS = 2_000;

type Listener = () => void;

const listeners = new Map<string, Set<Listener>>();

export function onRunSignal(runId: string, listener: Listener): () => void {
  const listening = listeners.get(runId) ?? new Set<Listener>();
  listeners.set(runId, listening);
  listening.add(listener);
  return () => {
    listening.delete(listener);
    if (listening.size === 0 && listeners.get(runId) === listening) listeners.delete(runId);
  };
}

export function dispatchRunSignal(runId: string): void {
  for (const listener of [...(listeners.get(runId) ?? [])]) listener();
}
