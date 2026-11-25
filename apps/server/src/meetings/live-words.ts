import {
  MEETING_LIVE_WORDS_STALE_MS,
  meetingLiveWordsSchema,
  type MeetingLiveWords,
  type MeetingSpeaker,
} from '@spark-outpost/contracts';

export type WordsListener = (words: MeetingLiveWords) => void;

export interface LiveWords {
  begin(meetingId: string): void;
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

  return {
    begin(meetingId) {
      if (!meetings.has(meetingId)) {
        meetings.set(meetingId, { latest: new Map(), watchers: new Set() });
      }
    },

    push(meetingId, words) {
      const live = meetings.get(meetingId);
      const parsed = meetingLiveWordsSchema.safeParse(words);
      if (!live || !parsed.success) return;
      live.latest.set(parsed.data.speaker, { words: parsed.data, at: now() });
      for (const watcher of live.watchers) watcher.listener(parsed.data);
    },

    watch(meetingId, listener, onEnd) {
      const live = meetings.get(meetingId);
      if (!live) {
        onEnd();
        return () => undefined;
      }
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
