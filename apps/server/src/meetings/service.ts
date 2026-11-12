import {
  MEETING_LINES_APPEND_MAX,
  newMeetingLineSchema,
  type Meeting,
  type MeetingStatus,
  type NewMeetingLine,
  type StartMeetingRequest,
} from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import { MEETINGS_NEED_THE_MAC_APP, type MeetingSource } from './source.ts';
import {
  MeetingAlreadyRecording,
  appendLines,
  createMeeting,
  deleteMeeting,
  endMeeting,
  failInterruptedNotes,
  getMeeting,
  interruptRecordings,
  recordingMeeting,
} from './store.ts';

export class MeetingError extends Error {
  constructor(
    readonly status: 404 | 409 | 503,
    message: string,
  ) {
    super(message);
  }
}

export function meetingErrorStatus(error: unknown): { status: number; message: string } | null {
  return error instanceof MeetingError ? { status: error.status, message: error.message } : null;
}

export interface MeetingServiceOptions {
  db: Db;
  workspaceId: string;
  source: MeetingSource | null;
  publish: (event: string) => void;
  onEnded?: (meeting: Meeting) => void;
  writeNotes?: (meetingId: string) => Promise<void>;
}

export interface MeetingService {
  readonly writeNotes: ((meetingId: string) => Promise<void>) | undefined;
  announce(meetingId: string): void;
  status(): Promise<MeetingStatus>;
  start(request: StartMeetingRequest): Promise<Meeting>;
  stop(meetingId: string): Promise<Meeting | null>;
  remove(meetingId: string): Promise<boolean>;
  recover(): Promise<void>;
}

function validLines(lines: readonly NewMeetingLine[]): NewMeetingLine[] {
  const valid: NewMeetingLine[] = [];
  for (const line of lines) {
    const parsed = newMeetingLineSchema.safeParse(line);
    if (parsed.success) valid.push(parsed.data);
  }
  return valid;
}

export function createMeetingService(options: MeetingServiceOptions): MeetingService {
  const { db, workspaceId, source } = options;

  const announce = (meetingId: string) =>
    options.publish(
      JSON.stringify({ kind: 'meeting', conversationId: null, runId: null, meetingId }),
    );

  const deliverTo = (meetingId: string) => async (lines: NewMeetingLine[]) => {
    const accepted = validLines(lines);
    for (let from = 0; from < accepted.length; from += MEETING_LINES_APPEND_MAX) {
      const chunk = accepted.slice(from, from + MEETING_LINES_APPEND_MAX);
      const stored = await appendLines(db, workspaceId, meetingId, chunk);
      if (!stored) return;
      announce(meetingId);
    }
  };

  const notifyEnded = (meeting: Meeting) => {
    try {
      options.onEnded?.(meeting);
    } catch {
      return;
    }
  };

  async function finish(meetingId: string, state: 'ended' | 'interrupted'): Promise<void> {
    const ended = await endMeeting(db, workspaceId, meetingId, state);
    if (!ended) return;
    announce(meetingId);
    if (state === 'interrupted') return;
    notifyEnded(ended);
  }

  async function stopSource(meetingId: string, state: 'ended' | 'interrupted'): Promise<void> {
    try {
      await source?.stop(meetingId);
    } finally {
      await finish(meetingId, state);
    }
  }

  return {
    writeNotes: options.writeNotes,
    announce,

    async status() {
      const recording = await recordingMeeting(db, workspaceId);
      return {
        available: source !== null,
        reason: source ? null : MEETINGS_NEED_THE_MAC_APP,
        recordingId: recording?.id ?? null,
      };
    },

    async start(request) {
      if (!source) throw new MeetingError(503, MEETINGS_NEED_THE_MAC_APP);
      let meeting: Meeting;
      try {
        meeting = await createMeeting(db, workspaceId, request);
      } catch (error) {
        if (error instanceof MeetingAlreadyRecording) throw new MeetingError(409, error.message);
        throw error;
      }
      announce(meeting.id);
      try {
        await source.start(meeting.id, deliverTo(meeting.id));
      } catch (error) {
        await finish(meeting.id, 'interrupted');
        throw error;
      }
      return (await getMeeting(db, workspaceId, meeting.id)) ?? meeting;
    },

    async stop(meetingId) {
      const meeting = await getMeeting(db, workspaceId, meetingId);
      if (meeting?.state === 'recording') await stopSource(meetingId, 'ended');
      return meeting && (await getMeeting(db, workspaceId, meetingId));
    },

    async remove(meetingId) {
      const meeting = await getMeeting(db, workspaceId, meetingId);
      if (!meeting) return false;
      if (meeting.state === 'recording') await stopSource(meetingId, 'interrupted');
      const removed = await deleteMeeting(db, workspaceId, meetingId);
      if (!removed) return false;
      announce(meetingId);
      return true;
    },

    async recover() {
      const interrupted = await interruptRecordings(db, workspaceId);
      await failInterruptedNotes(db, workspaceId);
      for (const id of interrupted) announce(id);
    },
  };
}
