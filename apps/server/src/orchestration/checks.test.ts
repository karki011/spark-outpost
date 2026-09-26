import { describe, expect, it } from 'vitest';
import { queueRecord } from './checks.ts';

const tick = () => new Promise((done) => setTimeout(done, 5));

describe('queueRecord', () => {
  it('runs check records of one task one after another', async () => {
    const log: string[] = [];
    const write = (name: string) => async () => {
      log.push(`${name} start`);
      await tick();
      log.push(`${name} end`);
    };
    await Promise.all([queueRecord('task', write('first')), queueRecord('task', write('second'))]);
    expect(log).toEqual(['first start', 'first end', 'second start', 'second end']);
  });

  it('keeps going after a failed record and reports the failure to its caller', async () => {
    const failed = queueRecord('task', async () => {
      throw new Error('duplicate key');
    });
    const after = queueRecord('task', async () => undefined);
    await expect(failed).rejects.toThrow('duplicate key');
    await expect(after).resolves.toBeUndefined();
  });

  it('does not hold one task behind another', async () => {
    const log: string[] = [];
    let release = () => {};
    const blocked = queueRecord('a', () => new Promise<void>((done) => (release = done)));
    await queueRecord('b', async () => {
      log.push('b');
    });
    expect(log).toEqual(['b']);
    release();
    await blocked;
  });
});
