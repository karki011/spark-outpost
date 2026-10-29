const SHUTDOWN_WATCHDOG_MS = 15_000;

type ShutdownStep = readonly [name: string, run: () => unknown];

type Report = (message: string, error: unknown) => void;

const reportToConsole: Report = (message, error) => console.error(message, error);

export async function runShutdownSteps(
  steps: readonly ShutdownStep[],
  report: Report = reportToConsole,
): Promise<void> {
  for (const [name, run] of steps) {
    try {
      await run();
    } catch (error) {
      report(`Could not stop ${name} during shutdown`, error);
    }
  }
}

export function armShutdownWatchdog(
  exit: (code: number) => void,
  log: (line: string) => void = console.error,
  afterMs = SHUTDOWN_WATCHDOG_MS,
): NodeJS.Timeout {
  return setTimeout(() => {
    log(`Shutdown did not finish within ${afterMs / 1000} s; exiting now.`);
    exit(1);
  }, afterMs);
}
