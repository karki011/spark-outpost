import {
  meetingBridgeToHostSchema,
  MEETING_LINES_APPEND_MAX,
  type MeetingBridgeFromHost,
} from '@spark-outpost/contracts';
import type { BridgePort, WorkerBridge } from '../browser/bridge.ts';
import type { MeetingCapture } from './meeting-capture.ts';

export interface MeetingHub {
  connect(port: BridgePort): WorkerBridge;
  attach(capture: MeetingCapture): void;
}

export function createMeetingHub(): MeetingHub {
  const ports = new Set<BridgePort>();
  let capture: MeetingCapture | null = null;

  const state = (): MeetingBridgeFromHost | null =>
    capture ? { kind: 'meeting:state', ...capture.state() } : null;

  const tellAll = () => {
    const message = state();
    if (message) for (const port of ports) port.post(message);
  };

  return {
    connect(port) {
      ports.add(port);
      const mine = new Set<string>();
      const post = (message: MeetingBridgeFromHost) => {
        if (ports.has(port)) port.post(message);
      };
      return {
        receive(raw) {
          const parsed = meetingBridgeToHostSchema.safeParse(raw);
          if (!parsed.success) return;
          const message = parsed.data;
          if (message.kind === 'meeting:status') {
            const current = state();
            if (current) post(current);
            return;
          }
          const { meetingId } = message;
          if (!capture) {
            if (message.kind === 'meeting:start') {
              post({ kind: 'meeting:ended', meetingId, reason: 'failed', detail: null });
            }
            return;
          }
          if (message.kind === 'meeting:stop') {
            capture.stop(meetingId);
            return;
          }
          mine.add(meetingId);
          capture
            .start(meetingId, {
              lines: (lines) => {
                for (let from = 0; from < lines.length; from += MEETING_LINES_APPEND_MAX) {
                  post({
                    kind: 'meeting:lines',
                    meetingId,
                    lines: lines.slice(from, from + MEETING_LINES_APPEND_MAX),
                  });
                }
              },
              ended: (reason, detail) => {
                mine.delete(meetingId);
                post({ kind: 'meeting:ended', meetingId, reason, detail });
              },
            })
            .then(
              () => post({ kind: 'meeting:started', meetingId }),
              (error: Error) => {
                mine.delete(meetingId);
                post({
                  kind: 'meeting:ended',
                  meetingId,
                  reason: 'failed',
                  detail: error.message.slice(0, 300),
                });
              },
            );
        },
        close() {
          ports.delete(port);
          for (const meetingId of mine) capture?.stop(meetingId);
          mine.clear();
        },
      };
    },

    attach(next) {
      capture = next;
      next.onState(tellAll);
      tellAll();
    },
  };
}

export const meetingHub = createMeetingHub();
