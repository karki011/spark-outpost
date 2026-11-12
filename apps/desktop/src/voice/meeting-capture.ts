import type { NewMeetingLine, VoiceErrorCode, VoiceHelperMessage } from '@spark-outpost/contracts';
import type { VoiceHelper } from './helper-process.ts';

export interface MeetingCaptureState {
  available: boolean;
  reason: string | null;
}

export interface MeetingSink {
  lines(lines: NewMeetingLine[]): void;
  ended(reason: 'stopped' | 'failed', detail: string | null): void;
}

export interface MeetingCapture {
  state(): MeetingCaptureState;
  start(meetingId: string, sink: MeetingSink): Promise<void>;
  stop(meetingId: string): void;
  recording(): boolean;
  onState(listener: () => void): void;
  changed(): void;
}

export interface MeetingCaptureEffects {
  helper: VoiceHelper;
  state(): MeetingCaptureState;
  prepare(): Promise<string | null>;
  language: string;
  log(line: string): void;
  startTimeoutMs?: number;
}

const START_TIMEOUT_MS = 10_000;
const COULD_NOT_START = 'The Mac could not start recording.';
const HELPER_STOPPED = 'Voice stopped while the meeting was recording.';

const PROBLEMS: Partial<Record<VoiceErrorCode, string>> = {
  mic_denied:
    'Allow the microphone for Spark Outpost in System Settings → Privacy & Security → Microphone.',
  no_input_device: 'No microphone is connected.',
  model_missing: 'Voice is still getting its speech model. Settings → Voice shows its download.',
  busy: 'Voice is listening. Start the meeting when it is done.',
};

interface Recording {
  sink: MeetingSink;
  started: ((problem: string | null) => void) | null;
}

export function createMeetingCapture(effects: MeetingCaptureEffects): MeetingCapture {
  const recordings = new Map<string, Recording>();
  const listeners: (() => void)[] = [];

  const fail = (meetingId: string, detail: string) => {
    const recording = recordings.get(meetingId);
    if (!recording) return;
    recordings.delete(meetingId);
    if (recording.started) recording.started(detail);
    else recording.sink.ended('failed', detail);
  };

  effects.helper.onMessage((message: VoiceHelperMessage) => {
    if (message.id === null) return;
    const recording = recordings.get(message.id);
    if (!recording) return;
    switch (message.event) {
      case 'meeting_started':
        recording.started?.(null);
        return;
      case 'meeting_system':
        if (!message.on) effects.log("meeting: the Mac's audio could not be captured");
        return;
      case 'meeting_line':
        recording.sink.lines([
          {
            speaker: message.source,
            text: message.text,
            startMs: message.startMs,
            endMs: Math.max(message.startMs, message.endMs),
          },
        ]);
        return;
      case 'meeting_ended':
        recordings.delete(message.id);
        recording.sink.ended('stopped', null);
        return;
      case 'error':
        fail(message.id, PROBLEMS[message.error] ?? COULD_NOT_START);
        return;
      default:
        return;
    }
  });
  effects.helper.onExit(() => {
    for (const meetingId of [...recordings.keys()]) fail(meetingId, HELPER_STOPPED);
  });

  return {
    state: () => effects.state(),

    async start(meetingId, sink) {
      const problem = await effects.prepare();
      if (problem) throw new Error(problem);
      const outcome = await new Promise<string | null>((resolve) => {
        const timer = setTimeout(() => {
          recordings.delete(meetingId);
          effects.helper.send({ op: 'meeting.stop' }, meetingId);
          resolve(COULD_NOT_START);
        }, effects.startTimeoutMs ?? START_TIMEOUT_MS);
        const recording: Recording = {
          sink,
          started: (result) => {
            clearTimeout(timer);
            recording.started = null;
            resolve(result);
          },
        };
        recordings.set(meetingId, recording);
        try {
          effects.helper.send({ op: 'meeting.start', language: effects.language }, meetingId);
        } catch {
          recordings.delete(meetingId);
          clearTimeout(timer);
          resolve(COULD_NOT_START);
        }
      });
      if (outcome) throw new Error(outcome);
    },

    stop(meetingId) {
      if (!recordings.has(meetingId)) return;
      try {
        effects.helper.send({ op: 'meeting.stop' }, meetingId);
      } catch {
        fail(meetingId, HELPER_STOPPED);
      }
    },

    recording: () => recordings.size > 0,
    onState: (listener) => void listeners.push(listener),
    changed: () => {
      for (const listener of listeners) listener();
    },
  };
}
