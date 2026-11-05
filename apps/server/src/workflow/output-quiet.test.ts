import { describe, expect, it } from 'vitest';
import { createOutputQuiet } from './output-quiet.ts';

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('waiting for the agent output to go quiet', () => {
  it('waits for output already on its way before it answers', async () => {
    const quiet = createOutputQuiet(20, 2_000);
    const seen: string[] = [];
    async function* agent() {
      yield 'first';
      await pause(5);
      yield 'second';
    }
    const consuming = (async () => {
      for await (const output of quiet.tracked(agent())) {
        await pause(40);
        seen.push(output);
      }
    })();
    await pause(1);
    await quiet.settled();
    expect(seen).toEqual(['first', 'second']);
    await consuming;
  });

  it('gives up after the longest wait when the output never stops', async () => {
    const quiet = createOutputQuiet(20, 60);
    let running = true;
    async function* agent() {
      while (running) {
        yield 'more';
        await pause(5);
      }
    }
    const consuming = (async () => {
      for await (const output of quiet.tracked(agent())) expect(output).toBe('more');
    })();
    const started = Date.now();
    await quiet.settled();
    expect(Date.now() - started).toBeLessThan(1_000);
    running = false;
    await consuming;
  });
});
