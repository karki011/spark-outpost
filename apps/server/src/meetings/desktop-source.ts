import {
  BROWSER_HOST_ENV,
  MEETING_START_TIMEOUT_MS,
  MEETING_STOP_TIMEOUT_MS,
  meetingBridgeFromHostSchema,
  type MeetingBridgeFromHost,
  type MeetingBridgeToHost,
} from '@spark-outpost/contracts';
import type { BridgePort } from '../browser/bridge-client.ts';
import {
  MEETINGS_NEED_THE_MAC_APP,
  MeetingSourceError,
  type DeliverLines,
  type MeetingSource,
  type MeetingSourceState,
} from './source.ts';

export interface DesktopMeetingSourceOptions {
  port: BridgePort<MeetingBridgeToHost>;
  startTimeoutMs?: number;
  stopTimeoutMs?: number;
}

interface Running {
  deliver: DeliverLines;
  lost: () => void;
  started: (() => void) | null;
  failed: ((error: MeetingSourceError) => void) | null;
  stopped: (() => void) | null;
  delivering: Promise<void>;
}

const COULD_NOT_START = 'The Mac could not start recording.';

export function createDesktopMeetingSource(options: DesktopMeetingSourceOptions): MeetingSource {
  const startTimeoutMs = options.startTimeoutMs ?? MEETING_START_TIMEOUT_MS;
  const stopTimeoutMs = options.stopTimeoutMs ?? MEETING_STOP_TIMEOUT_MS;
  const running = new Map<string, Running>();
  const stateListeners: (() => void)[] = [];
  let state: MeetingSourceState = { available: false, reason: MEETINGS_NEED_THE_MAC_APP };

  const ended = (message: Extract<MeetingBridgeFromHost, { kind: 'meeting:ended' }>) => {
    const entry = running.get(message.meetingId);
    if (!entry) return;
    running.delete(message.meetingId);
    if (entry.failed) {
      entry.failed(new MeetingSourceError(message.detail ?? COULD_NOT_START));
      return;
    }
    if (entry.stopped) {
      void entry.delivering.then(entry.stopped);
      return;
    }
    void entry.delivering.then(entry.lost);
  };

  options.port.subscribe((raw) => {
    const parsed = meetingBridgeFromHostSchema.safeParse(raw);
    if (!parsed.success) return;
    const message = parsed.data;
    if (message.kind === 'meeting:state') {
      state = { available: message.available, reason: message.reason };
      for (const listener of stateListeners) listener();
      return;
    }
    if (message.kind === 'meeting:ended') {
      ended(message);
      return;
    }
    const entry = running.get(message.meetingId);
    if (!entry) return;
    if (message.kind === 'meeting:started') {
      entry.started?.();
      return;
    }
    entry.delivering = entry.delivering
      .then(() => entry.deliver(message.lines))
      .catch(() => undefined);
  });
  options.port.post({ kind: 'meeting:status' });

  return {
    state: () => state,
    onState: (listener) => void stateListeners.push(listener),

    start(meetingId, deliver, lost) {
      return new Promise<void>((resolve, reject) => {
        const entry: Running = {
          deliver,
          lost,
          started: null,
          failed: null,
          stopped: null,
          delivering: Promise.resolve(),
        };
        const timer = setTimeout(() => {
          running.delete(meetingId);
          options.port.post({ kind: 'meeting:stop', meetingId });
          reject(new MeetingSourceError(COULD_NOT_START));
        }, startTimeoutMs);
        entry.started = () => {
          clearTimeout(timer);
          entry.started = null;
          entry.failed = null;
          resolve();
        };
        entry.failed = (error) => {
          clearTimeout(timer);
          reject(error);
        };
        running.set(meetingId, entry);
        options.port.post({ kind: 'meeting:start', meetingId });
      });
    },

    stop(meetingId) {
      const entry = running.get(meetingId);
      if (!entry) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          running.delete(meetingId);
          resolve();
        }, stopTimeoutMs);
        entry.stopped = () => {
          clearTimeout(timer);
          resolve();
        };
        options.port.post({ kind: 'meeting:stop', meetingId });
      });
    },
  };
}

interface ParentPort {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (event: { data: unknown }) => void): void;
}

export function connectDesktopMeetings(
  env: NodeJS.ProcessEnv,
  owner: object,
): MeetingSource | null {
  const parent = (owner as { parentPort?: ParentPort }).parentPort;
  if (env[BROWSER_HOST_ENV] !== '1' || !parent) return null;
  return createDesktopMeetingSource({
    port: {
      post: (message) => parent.postMessage(message),
      subscribe: (listener) => parent.on('message', (event) => listener(event.data)),
    },
  });
}
