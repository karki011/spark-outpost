import {
  MEETING_LIVE_WORDS_STALE_MS,
  meetingLiveWordsSchema,
  type MeetingLiveWords,
  type MeetingSpeaker,
} from '@spark-outpost/contracts';

export type WordsListener = (words: MeetingLiveWords) => void;

export interface LiveWords {
  push(meetingId: string, words: MeetingLiveWords): void;
  watch(meetingId: string, listener: WordsListener, onEnd: () => void): () => void;
  watchers(meetingId: string): number;
  end(meetingId: string): void;
}

interface Watcher {
  listener: WordsListener;
  onEnd: () => void;
}

interface Heard {
  words: MeetingLiveWords;
  at: number;
}

interface Live {
  latest: Map<MeetingSpeaker, Heard>;
  watchers: Set<Watcher>;
}

export function createLiveWords(now: () => number = Date.now): LiveWords {
  const meetings = new Map<string, Live>();

  const liveFor = (meetingId: string): Live => {
    const known = meetings.get(meetingId);
    if (known) return known;
    const created: Live = { latest: new Map(), watchers: new Set() };
    meetings.set(meetingId, created);
    return created;
  };

  return {
    push(meetingId, words) {
      const parsed = meetingLiveWordsSchema.safeParse(words);
      if (!parsed.success) return;
      const live = liveFor(meetingId);
      live.latest.set(parsed.data.speaker, { words: parsed.data, at: now() });
      for (const watcher of live.watchers) watcher.listener(parsed.data);
    },

    watch(meetingId, listener, onEnd) {
      const live = liveFor(meetingId);
      const watcher: Watcher = { listener, onEnd };
      live.watchers.add(watcher);
      for (const heard of live.latest.values()) {
        if (now() - heard.at < MEETING_LIVE_WORDS_STALE_MS) listener(heard.words);
      }
      return () => {
        live.watchers.delete(watcher);
      };
    },

    watchers: (meetingId) => meetings.get(meetingId)?.watchers.size ?? 0,

    end(meetingId) {
      const live = meetings.get(meetingId);
      if (!live) return;
      meetings.delete(meetingId);
      for (const watcher of live.watchers) watcher.onEnd();
    },
  };
}
