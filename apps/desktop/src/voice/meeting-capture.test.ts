import { describe, expect, it, vi } from 'vitest';
import type { NewMeetingLine, VoiceHelperMessage } from '@spark-outpost/contracts';
import type { VoiceHelper, VoiceHelperRequest } from './helper-process.ts';
import { createMeetingCapture } from './meeting-capture.ts';
import { createMeetingHub } from './meeting-hub.ts';

const ID = '11111111-1111-4111-8111-111111111111';

function scene(prepare: () => Promise<string | null> = async () => null) {
  const sent: { request: VoiceHelperRequest; id: string | undefined }[] = [];
  const listeners: ((message: VoiceHelperMessage) => void)[] = [];
  const exits: (() => void)[] = [];
  const helper = {
    send: (request: VoiceHelperRequest, id?: string) => {
      sent.push({ request, id });
      return id ?? 'x';
    },
    onMessage: (listener: (message: VoiceHelperMessage) => void) => void listeners.push(listener),
    onExit: (listener: () => void) => void exits.push(listener),
  } as unknown as VoiceHelper;
  let available = true;
  const capture = createMeetingCapture({
    helper,
    state: () =>
      available
        ? { available: true, reason: null }
        : { available: false, reason: 'Turn on Voice in Settings → Voice to record meetings.' },
    prepare,
    language: 'en',
    log: () => undefined,
    startTimeoutMs: 400,
  });
  return {
    capture,
    sent,
    say: (message: VoiceHelperMessage) => listeners.forEach((listener) => listener(message)),
    exit: () => exits.forEach((listener) => listener()),
    setAvailable: (next: boolean) => {
      available = next;
      capture.changed();
    },
  };
}

function sink() {
  const lines: NewMeetingLine[] = [];
  const ended = vi.fn();
  return {
    lines,
    ended,
    sink: { lines: (next: NewMeetingLine[]) => void lines.push(...next), ended },
  };
}

async function started(test: ReturnType<typeof scene>) {
  const out = sink();
  const starting = test.capture.start(ID, out.sink);
  await vi.waitFor(() => expect(test.sent).toHaveLength(1));
  test.say({ id: ID, event: 'meeting_started' });
  await starting;
  return out;
}

describe('meeting capture', () => {
  it('starts the helper with the meeting id and passes lines on with their label', async () => {
    const test = scene();
    const out = await started(test);
    expect(test.sent[0]).toEqual({ request: { op: 'meeting.start', language: 'en' }, id: ID });
    test.say({ id: ID, event: 'meeting_system', on: true });
    test.say({
      id: ID,
      event: 'meeting_line',
      source: 'others',
      text: 'Hello',
      startMs: 0,
      endMs: 900,
    });
    test.say({
      id: ID,
      event: 'meeting_line',
      source: 'you',
      text: 'Hi',
      startMs: 1000,
      endMs: 1400,
    });
    expect(out.lines).toEqual([
      { speaker: 'others', text: 'Hello', startMs: 0, endMs: 900 },
      { speaker: 'you', text: 'Hi', startMs: 1000, endMs: 1400 },
    ]);
  });

  it('refuses to start with the reason when Voice is not ready, without waking the helper', async () => {
    const test = scene(async () => 'Turn on Voice in Settings → Voice to record meetings.');
    await expect(test.capture.start(ID, sink().sink)).rejects.toThrow('Turn on Voice');
    expect(test.sent).toEqual([]);
  });

  it('says how to allow the microphone when the helper is refused it', async () => {
    const test = scene();
    const starting = test.capture.start(ID, sink().sink);
    await vi.waitFor(() => expect(test.sent).toHaveLength(1));
    test.say({ id: ID, event: 'error', error: 'mic_denied', detail: 'no' });
    await expect(starting).rejects.toThrow('Allow the microphone for Spark Outpost');
  });

  it('gives up a start the helper never answers and tells it to stop', async () => {
    const test = scene();
    await expect(test.capture.start(ID, sink().sink)).rejects.toThrow(
      'The Mac could not start recording.',
    );
    expect(test.sent.at(-1)).toEqual({ request: { op: 'meeting.stop' }, id: ID });
  });

  it('ends as stopped only when the helper has sent its last line', async () => {
    const test = scene();
    const out = await started(test);
    test.capture.stop(ID);
    expect(test.sent.at(-1)).toEqual({ request: { op: 'meeting.stop' }, id: ID });
    expect(out.ended).not.toHaveBeenCalled();
    test.say({ id: ID, event: 'meeting_line', source: 'you', text: 'Last', startMs: 5, endMs: 9 });
    test.say({ id: ID, event: 'meeting_ended' });
    expect(out.lines.map((line) => line.text)).toEqual(['Last']);
    expect(out.ended).toHaveBeenCalledWith('stopped', null);
  });

  it('ends as failed when the helper quits mid-meeting', async () => {
    const test = scene();
    const out = await started(test);
    test.exit();
    expect(out.ended).toHaveBeenCalledWith(
      'failed',
      'Voice stopped while the meeting was recording.',
    );
  });
});

describe('the meeting hub', () => {
  function connected(test: ReturnType<typeof scene>, attach = true) {
    const hub = createMeetingHub();
    const posted: unknown[] = [];
    const bridge = hub.connect({ post: (message) => posted.push(message) });
    if (attach) hub.attach(test.capture);
    return { hub, bridge, posted };
  }

  it('tells a server that connected first as soon as capture exists, and again on change', () => {
    const test = scene();
    const { hub, posted } = connected(test, false);
    expect(posted).toEqual([]);
    hub.attach(test.capture);
    expect(posted).toEqual([{ kind: 'meeting:state', available: true, reason: null }]);
    test.setAvailable(false);
    expect(posted.at(-1)).toEqual({
      kind: 'meeting:state',
      available: false,
      reason: 'Turn on Voice in Settings → Voice to record meetings.',
    });
  });

  it('answers a start before capture exists as failed, and ignores what it cannot read', () => {
    const test = scene();
    const { bridge, posted } = connected(test, false);
    bridge.receive({ kind: 'meeting:start', meetingId: ID });
    bridge.receive({ kind: 'calendar:request', id: 'x' });
    bridge.receive({ kind: 'meeting:start', meetingId: 'nope' });
    expect(posted).toEqual([
      { kind: 'meeting:ended', meetingId: ID, reason: 'failed', detail: null },
    ]);
  });

  it('carries a meeting from start to its last line and stops it when the server goes away', async () => {
    const test = scene();
    const { bridge, posted } = connected(test);
    bridge.receive({ kind: 'meeting:start', meetingId: ID });
    await vi.waitFor(() => expect(test.sent).toHaveLength(1));
    test.say({ id: ID, event: 'meeting_started' });
    await vi.waitFor(() =>
      expect(posted.at(-1)).toEqual({ kind: 'meeting:started', meetingId: ID }),
    );
    test.say({ id: ID, event: 'meeting_line', source: 'you', text: 'Hi', startMs: 0, endMs: 5 });
    expect(posted.at(-1)).toEqual({
      kind: 'meeting:lines',
      meetingId: ID,
      lines: [{ speaker: 'you', text: 'Hi', startMs: 0, endMs: 5 }],
    });
    bridge.close();
    expect(test.sent.at(-1)).toEqual({ request: { op: 'meeting.stop' }, id: ID });
    const before = posted.length;
    test.say({ id: ID, event: 'meeting_ended' });
    expect(posted).toHaveLength(before);
  });

  it('reports a start the Mac refuses with its reason', async () => {
    const test = scene(async () => 'Turn on Voice in Settings → Voice to record meetings.');
    const { bridge, posted } = connected(test);
    bridge.receive({ kind: 'meeting:start', meetingId: ID });
    await vi.waitFor(() =>
      expect(posted.at(-1)).toEqual({
        kind: 'meeting:ended',
        meetingId: ID,
        reason: 'failed',
        detail: 'Turn on Voice in Settings → Voice to record meetings.',
      }),
    );
  });
});
