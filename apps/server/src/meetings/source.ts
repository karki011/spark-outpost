import type { MeetingLiveWords, NewMeetingLine } from '@spark-outpost/contracts';

export type DeliverLines = (lines: NewMeetingLine[]) => Promise<void>;
export type DeliverWords = (words: MeetingLiveWords) => void;

export interface MeetingSourceState {
  available: boolean;
  reason: string | null;
}

export interface MeetingSource {
  state(): MeetingSourceState;
  onState?(listener: () => void): void;
  start(
    meetingId: string,
    deliver: DeliverLines,
    lost: () => void,
    words?: DeliverWords,
  ): Promise<void>;
  stop(meetingId: string): Promise<void>;
}

export class MeetingSourceError extends Error {}

export const MEETINGS_NEED_THE_MAC_APP =
  'Recording a meeting needs the Spark Outpost Mac app with meeting capture.';
