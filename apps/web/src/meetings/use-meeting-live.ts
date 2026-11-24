import { useEffect, useState } from 'react';
import {
  MEETING_LIVE_WORDS_STALE_MS,
  meetingLiveWordsSchema,
  type MeetingLiveWords,
  type MeetingSpeaker,
} from '@spark-outpost/contracts';

type Live = Partial<Record<MeetingSpeaker, MeetingLiveWords>>;

function parseWords(raw: string): MeetingLiveWords | null {
  try {
    const parsed = meetingLiveWordsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function useMeetingLive(id: string, recording: boolean): MeetingLiveWords[] {
  const [live, setLive] = useState<Live>({});

  useEffect(() => {
    if (!recording || typeof EventSource !== 'function') return;
    const source = new EventSource(`/api/meetings/${id}/live`);
    const stale = new Map<MeetingSpeaker, ReturnType<typeof setTimeout>>();

    const forget = (speaker: MeetingSpeaker) =>
      setLive((current) => {
        if (!current[speaker]) return current;
        const next = { ...current };
        delete next[speaker];
        return next;
      });

    source.onmessage = (event: MessageEvent<string>) => {
      const words = parseWords(event.data);
      if (!words) return;
      clearTimeout(stale.get(words.speaker));
      stale.set(
        words.speaker,
        setTimeout(() => forget(words.speaker), MEETING_LIVE_WORDS_STALE_MS),
      );
      setLive((current) => ({ ...current, [words.speaker]: words }));
    };

    return () => {
      source.close();
      for (const timer of stale.values()) clearTimeout(timer);
      setLive({});
    };
  }, [id, recording]);

  return Object.values(live).sort((a, b) => a.startMs - b.startMs);
}
