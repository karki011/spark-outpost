import type { TurnDriver } from './driver.ts';

export interface Lifecycle {
  start: () => Promise<TurnDriver>;
  work: (driver: TurnDriver) => Promise<void>;
  log: (line: string) => void;
}

function said(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runThenClose(lifecycle: Lifecycle): Promise<number> {
  const { log } = lifecycle;
  let driver: TurnDriver;
  try {
    driver = await lifecycle.start();
  } catch (error) {
    log(`Failed: ${said(error)}`);
    return 1;
  }
  let code = 0;
  try {
    await lifecycle.work(driver);
  } catch (error) {
    log(`Failed: ${said(error)}`);
    code = 1;
  }
  try {
    await driver.close();
  } catch (error) {
    log(`Shutdown failed: ${said(error)}`);
    code = 1;
  }
  return code;
}
