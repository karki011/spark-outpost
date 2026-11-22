import { useMeeting, useMeetingStatus } from './use-meetings.ts';

export interface Recording {
  id: string;
  title: string;
  startedAt: number | null;
}

export function useRecordingId(): string | null {
  return useMeetingStatus().data?.recordingId ?? null;
}

export function useRecordingDetail(id: string): Recording {
  const meeting = useMeeting(id).data?.meeting;
  return {
    id,
    title: meeting?.title ?? 'Meeting',
    startedAt: meeting ? Date.parse(meeting.startedAt) : null,
  };
}
