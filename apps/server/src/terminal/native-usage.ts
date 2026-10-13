import { basename } from 'node:path';
import type { Db } from '../persistence/db.ts';
import {
  recordNativeReportedUsage,
  recordNativeTurnUsage,
} from '../persistence/native-terminal-usage.ts';
import { claudeTranscriptParser } from './claude-transcript.ts';
import type { LiveSession } from './native-runtime-types.ts';
import type { TranscriptWatcher, WatchTranscript } from './native-tail.ts';
import type { ReportedUsage, TranscriptParser } from './native-transcript.ts';
import { createTurnUsage, type TurnUsage } from './turn-usage.ts';

export interface SessionTranscript {
  path: string;
  parser: TranscriptParser;
  offset: number | null;
  watcher: TranscriptWatcher | null;
  turn: TurnUsage;
  turnChanged: boolean;
  reported: ReportedUsage | null;
}

type Enqueue = <T>(session: LiveSession, work: () => Promise<T>) => Promise<T>;
type OnInterrupt = (session: LiveSession, nativeTurnId: string) => Promise<void>;

export function nativeUsage(db: Db, watch: WatchTranscript, enqueue: Enqueue) {
  const save = async (session: LiveSession) => {
    const transcript = session.transcript;
    if (!transcript) return;
    const runId = session.context?.input.identity.runId;
    const totals = transcript.turn.totals();
    if (runId && totals && transcript.turnChanged) {
      transcript.turnChanged = false;
      await recordNativeTurnUsage(db, runId, totals);
    }
    const reported = transcript.reported;
    if (reported) {
      transcript.reported = null;
      await recordNativeReportedUsage(db, session.row.id, reported);
    }
  };
  const saveQuietly = (session: LiveSession) => save(session).catch(() => undefined);
  const open = (session: LiveSession, transcript: SessionTranscript, onInterrupt?: OnInterrupt) =>
    watch(transcript.path, transcript.offset, (lines) => {
      const interrupted: string[] = [];
      let changed = false;
      for (const record of lines.flatMap((line) => transcript.parser.push(line))) {
        if (record.kind === 'interrupt') interrupted.push(record.turnId);
        if (record.kind === 'reported' && reportedHere(transcript.path, record.usage)) {
          transcript.reported = record.usage;
          changed = true;
        }
        if (record.kind !== 'response' || !session.context) continue;
        if (record.turnId !== null && record.turnId !== session.row.native_turn_id) continue;
        if (!transcript.turn.add(record)) continue;
        transcript.turnChanged = true;
        changed = true;
      }
      return Promise.all([
        ...interrupted.map((turnId) => onInterrupt?.(session, turnId)),
        changed ? enqueue(session, () => saveQuietly(session)) : undefined,
      ]).then(() => undefined);
    });
  return {
    follow(session: LiveSession, path: string, onInterrupt: OnInterrupt) {
      if (session.transcript?.path !== path) {
        session.transcript?.watcher?.close();
        session.transcript = {
          path,
          parser: claudeTranscriptParser(),
          offset: null,
          watcher: null,
          turn: createTurnUsage(session.row.provider),
          turnChanged: false,
          reported: null,
        };
      }
      const transcript = session.transcript;
      transcript.watcher ??= open(session, transcript, onInterrupt);
    },
    async settle(session: LiveSession) {
      const transcript = session.transcript;
      if (!transcript) return;
      const watcher = transcript.watcher;
      if (watcher) {
        await watcher.flush();
        transcript.offset = watcher.offset() ?? transcript.offset;
        watcher.close();
        transcript.watcher = null;
      }
      await saveQuietly(session);
      transcript.turn.clear();
      transcript.turnChanged = false;
    },
    async last(session: LiveSession) {
      const transcript = session.transcript;
      if (!transcript || transcript.watcher) return;
      const watcher = open(session, transcript);
      if (!watcher) return;
      await watcher.ready;
      transcript.offset = watcher.offset() ?? transcript.offset;
      watcher.close();
      await saveQuietly(session);
    },
  };
}

function reportedHere(path: string, usage: ReportedUsage): boolean {
  return basename(path) === `${usage.nativeSessionId}.jsonl`;
}

export type NativeUsage = ReturnType<typeof nativeUsage>;
