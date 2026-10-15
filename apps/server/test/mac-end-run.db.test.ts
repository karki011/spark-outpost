import { afterEach, describe, expect, it } from 'vitest';
import type { MacHostRequest } from '@spark-outpost/contracts';
import type { MacHost } from '../src/mac-control/host-client.ts';
import { MacHarness } from './spark-mac-support.ts';
import { nativeRuntimeFixture, type NativeRuntimeFixture } from './native-terminal-fixture.ts';
import { eventually } from './support.ts';

class EndRuns implements MacHost {
  readonly ended: Extract<MacHostRequest, { op: 'end_run' }>[] = [];

  request(request: MacHostRequest): Promise<never> {
    if (request.op === 'end_run') this.ended.push(request);
    return Promise.resolve({ ended: true } as never);
  }
}

let fixture: NativeRuntimeFixture | null = null;
let harness: MacHarness | null = null;

afterEach(async () => {
  await fixture?.cleanup();
  await harness?.close();
  fixture = null;
  harness = null;
});

describe('ending Mac control with the turn', () => {
  it('ends a chat turn’s Mac control when its Spark tools grant is revoked', async () => {
    harness = await MacHarness.create();
    await harness.start({ mode: 'auto' });
    await harness.revoke();
    const ended = await eventually(
      async () => harness!.fake.requests.find((request) => request.op === 'end_run') ?? null,
    );
    expect(ended).toEqual({
      op: 'end_run',
      chatId: harness.chat.conversationId,
      runId: harness.chat.runId,
    });
  });

  it('ends a Terminal turn’s Mac control when the turn finishes, and the rest when the session stops', async () => {
    const mac = new EndRuns();
    fixture = await nativeRuntimeFixture({ mac });
    await fixture.launch();
    await fixture.hook('SessionStart');
    await fixture.hook('UserPromptSubmit', { prompt: 'Read Calculator', turn_id: 'turn-1' });
    const { rows } = await fixture.t.db.query<{ id: string }>(
      'SELECT id FROM runs WHERE conversation_id = $1',
      [fixture.conversationId],
    );
    await fixture.hook('Stop', { turn_id: 'turn-1' });
    await eventually(async () => (mac.ended.length > 0 ? true : null));
    expect(mac.ended[0]).toEqual({
      op: 'end_run',
      chatId: fixture.conversationId,
      runId: rows[0]!.id,
    });
    await fixture.runtime.stop(fixture.conversationId);
    await eventually(async () => (mac.ended.length > 1 ? true : null));
    expect(mac.ended.at(-1)).toMatchObject({ chatId: fixture.conversationId, runId: null });
  });
});
