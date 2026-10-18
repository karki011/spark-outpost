import { rmSync } from 'node:fs';
import { TEST_TMPDIR } from './stub-config.ts';

export const FRESH_TEST_TMPDIR = `rm -rf ${JSON.stringify(TEST_TMPDIR)} && mkdir -p ${JSON.stringify(TEST_TMPDIR)}`;

function removeTestTmpdir(): void {
  try {
    rmSync(TEST_TMPDIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    console.warn(`Could not remove ${TEST_TMPDIR}: ${(error as Error).message}`);
  }
}

export function removeTestTmpdirWhenStopped(): void {
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      removeTestTmpdir();
      process.exit(0);
    });
  }
}
