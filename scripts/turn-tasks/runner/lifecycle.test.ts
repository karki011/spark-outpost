import { describe, expect, it } from 'vitest';
import { runThenClose } from './lifecycle.ts';
import { stubDriver } from './test-support.ts';

function logged() {
  const lines: string[] = [];
  return { lines, log: (line: string) => void lines.push(line) };
}

describe('the runner from start to exit', () => {
  it('shuts the instance down and reports success when the work is done', async () => {
    const driver = stubDriver();
    const { lines, log } = logged();
    const code = await runThenClose({
      start: async () => driver,
      work: async () => undefined,
      log,
    });
    expect(code).toBe(0);
    expect(driver.closed).toBe(true);
    expect(lines).toEqual([]);
  });

  it('shuts the instance down when the work fails, says why and reports failure', async () => {
    const driver = stubDriver();
    const { lines, log } = logged();
    const code = await runThenClose({
      start: async () => driver,
      work: async () => {
        throw new Error('the check could not be collected');
      },
      log,
    });
    expect(code).toBe(1);
    expect(driver.closed).toBe(true);
    expect(lines).toEqual(['Failed: the check could not be collected']);
  });

  it('reports failure when the instance cannot start, with nothing to shut down', async () => {
    const { lines, log } = logged();
    let worked = false;
    const code = await runThenClose({
      start: async () => {
        throw new Error('This run needs TEST_DATABASE_URL.');
      },
      work: async () => {
        worked = true;
      },
      log,
    });
    expect(code).toBe(1);
    expect(worked).toBe(false);
    expect(lines).toEqual(['Failed: This run needs TEST_DATABASE_URL.']);
  });

  it('reports failure when the shutdown itself fails, after the work succeeded', async () => {
    const driver = stubDriver({ failClose: 'the schema could not be dropped' });
    const { lines, log } = logged();
    const code = await runThenClose({
      start: async () => driver,
      work: async () => undefined,
      log,
    });
    expect(code).toBe(1);
    expect(lines).toEqual(['Shutdown failed: the schema could not be dropped']);
  });

  it('gives both reasons when the work and the shutdown fail', async () => {
    const driver = stubDriver({ failClose: 'worker did not stop' });
    const { lines, log } = logged();
    const code = await runThenClose({
      start: async () => driver,
      work: async () => Promise.reject(new Error('boom')),
      log,
    });
    expect(code).toBe(1);
    expect(lines).toEqual(['Failed: boom', 'Shutdown failed: worker did not stop']);
  });
});
