import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { MeetingBridgeToHost, NewMeetingLine } from '@spark-outpost/contracts';
import { createDesktopMeetingSource } from './desktop-source.ts';
import { MEETINGS_NEED_THE_MAC_APP, type DeliverLines } from './source.ts';

function scene(timeouts: { startTimeoutMs?: number; stopTimeoutMs?: number } = {}) {
  const posted: MeetingBridgeToHost[] = [];
  let listener: (message: unknown) => void = () => undefined;
  const source = createDesktopMeetingSource({
    port: {
      post: (message) => posted.push(message),
      subscribe: (next) => {
        listener = next;
      },
    },
    ...timeouts,
  });
  return { source, posted, host: (message: unknown) => listener(message) };
}

const line = (text: string): NewMeetingLine => ({ speaker: 'you', text, startMs: 0, endMs: 900 });

async function started(
  test: ReturnType<typeof scene>,
  deliver: DeliverLines = vi.fn(async () => undefined),
) {
  const meetingId = randomUUID();
  const lost = vi.fn();
  const starting = test.source.start(meetingId, deliver, lost);
  test.host({ kind: 'meeting:started', meetingId });
  await starting;
  return { meetingId, deliver, lost };
}

describe('the desktop meeting source', () => {
  it('is unavailable until the Mac app says it can record, and asks at once', () => {
    const test = scene();
    expect(test.posted).toEqual([{ kind: 'meeting:status' }]);
    expect(test.source.state()).toEqual({ available: false, reason: MEETINGS_NEED_THE_MAC_APP });
    test.host({ kind: 'meeting:state', available: false, reason: 'Turn on Voice first.' });
    expect(test.source.state()).toEqual({ available: false, reason: 'Turn on Voice first.' });
    test.host({ kind: 'meeting:state', available: true, reason: null });
    expect(test.source.state()).toEqual({ available: true, reason: null });
  });

  it('starts when the Mac confirms and delivers lines in the order they arrive', async () => {
    const test = scene();
    const seen: string[] = [];
    const { meetingId } = await started(
      test,
      vi.fn(async (lines: NewMeetingLine[]) => {
        await new Promise((resolve) => setTimeout(resolve, lines[0]!.text === 'one' ? 20 : 0));
        seen.push(...lines.map((each) => each.text));
      }),
    );
    expect(test.posted.at(-1)).toEqual({ kind: 'meeting:start', meetingId });
    test.host({ kind: 'meeting:lines', meetingId, lines: [line('one')] });
    test.host({ kind: 'meeting:lines', meetingId, lines: [line('two')] });
    await vi.waitFor(() => expect(seen).toEqual(['one', 'two']));
  });

  it("fails the start with the Mac's reason", async () => {
    const test = scene();
    const meetingId = randomUUID();
    const starting = test.source.start(meetingId, vi.fn(), vi.fn());
    test.host({
      kind: 'meeting:ended',
      meetingId,
      reason: 'failed',
      detail: 'Allow the microphone in System Settings.',
    });
    await expect(starting).rejects.toThrow('Allow the microphone in System Settings.');
  });

  it('gives up a start the Mac never answers and tells it to stop', async () => {
    const test = scene({ startTimeoutMs: 20 });
    const meetingId = randomUUID();
    await expect(test.source.start(meetingId, vi.fn(), vi.fn())).rejects.toThrow(
      'The Mac could not start recording.',
    );
    expect(test.posted.at(-1)).toEqual({ kind: 'meeting:stop', meetingId });
  });

  it('a stop waits for the last lines before it resolves', async () => {
    const test = scene();
    const seen: string[] = [];
    const { meetingId, lost } = await started(
      test,
      vi.fn(async (lines: NewMeetingLine[]) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        seen.push(...lines.map((each) => each.text));
      }),
    );
    let stopped = false;
    const stopping = test.source.stop(meetingId).then(() => {
      stopped = true;
    });
    expect(test.posted.at(-1)).toEqual({ kind: 'meeting:stop', meetingId });
    test.host({ kind: 'meeting:lines', meetingId, lines: [line('the last sentence')] });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(stopped).toBe(false);
    test.host({ kind: 'meeting:ended', meetingId, reason: 'stopped', detail: null });
    await stopping;
    expect(seen).toEqual(['the last sentence']);
    expect(lost).not.toHaveBeenCalled();
  });

  it('a stop the Mac never answers still resolves', async () => {
    const test = scene({ stopTimeoutMs: 20 });
    const { meetingId } = await started(test);
    await test.source.stop(meetingId);
  });

  it('says the recording was lost when capture ends by itself', async () => {
    const test = scene();
    const { meetingId, lost } = await started(test);
    test.host({ kind: 'meeting:ended', meetingId, reason: 'failed', detail: 'The helper quit.' });
    await vi.waitFor(() => expect(lost).toHaveBeenCalledTimes(1));
  });

  it('ignores lines for a meeting it is not recording and messages it cannot read', async () => {
    const test = scene();
    const { deliver } = await started(test);
    test.host({ kind: 'meeting:lines', meetingId: randomUUID(), lines: [line('stray')] });
    test.host({ kind: 'meeting:lines', meetingId: 'not-an-id', lines: [] });
    test.host('nonsense');
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(deliver).not.toHaveBeenCalled();
  });
});
