import type { NewMeetingLine } from '@spark-outpost/contracts';

export type DeliverLines = (lines: NewMeetingLine[]) => Promise<void>;

export interface MeetingSource {
  start(meetingId: string, deliver: DeliverLines): Promise<void>;
  stop(meetingId: string): Promise<void>;
}

export const MEETINGS_NEED_THE_MAC_APP =
  'Recording a meeting needs the Spark Outpost Mac app with meeting capture.';
