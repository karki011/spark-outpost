export interface ShutdownEffects {
  stop: () => Promise<void>;
  closeWindow: () => void;
  showError: (message: string, detail: string) => Promise<unknown>;
  exit: (code: number) => void;
}

export interface Shutdown {
  failed: AbortSignal;
  fail(message: string, detail: string): void;
  quit(): void;
}

export function createShutdown(effects: ShutdownEffects): Shutdown {
  const failure = new AbortController();
  let stopping: Promise<void> | null = null;
  const stopOnce = () => (stopping ??= effects.stop());
  return {
    failed: failure.signal,
    fail(message, detail) {
      if (failure.signal.aborted) return;
      failure.abort();
      effects.closeWindow();
      void stopOnce()
        .catch(() => undefined)
        .then(() => effects.showError(message, detail))
        .finally(() => effects.exit(1));
    },
    quit() {
      if (failure.signal.aborted) return;
      const first = stopping === null;
      const stopped = stopOnce();
      if (first) effects.closeWindow();
      void stopped.finally(() => effects.exit(0));
    },
  };
}
