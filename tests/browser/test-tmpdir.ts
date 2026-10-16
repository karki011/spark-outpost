import { rmSync } from 'node:fs';
import { TEST_TMPDIR } from './stub-config.ts';

export const FRESH_TEST_TMPDIR = `rm -rf ${JSON.stringify(TEST_TMPDIR)} && mkdir -p ${JSON.stringify(TEST_TMPDIR)}`;

export default function removeTestTmpdir(): void {
  rmSync(TEST_TMPDIR, { recursive: true, force: true });
}
