import { ZOOM_NOT_CONNECTED } from '@spark-outpost/contracts';
import type { GoogleEventCreate } from '../calendar/google/api.ts';
import { ZoomSignInNeeded, type ZoomService } from './service.ts';

const MINUTE_MS = 60_000;

export function withZoomLink(event: GoogleEventCreate, joinUrl: string): GoogleEventCreate {
  const line = `Join Zoom meeting: ${joinUrl}`;
  return {
    ...event,
    location: event.location || joinUrl,
    description: event.description ? `${event.description}\n\n${line}` : line,
  };
}

export async function withZoomMeeting<T extends string>(
  zoom: ZoomService | null,
  event: GoogleEventCreate,
  create: (event: GoogleEventCreate) => Promise<T>,
): Promise<T> {
  if (!zoom) throw new ZoomSignInNeeded(ZOOM_NOT_CONNECTED);
  const meeting = await zoom.createMeeting({
    topic: event.summary,
    start: event.start,
    minutes: Math.max(1, Math.round((Date.parse(event.end) - Date.parse(event.start)) / MINUTE_MS)),
  });
  const discard = () => zoom.deleteMeeting(meeting.id).catch(() => undefined);
  try {
    const outcome = await create(withZoomLink(event, meeting.joinUrl));
    if (outcome !== 'created') await discard();
    return outcome;
  } catch (error) {
    await discard();
    throw error;
  }
}
