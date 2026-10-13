import { basename } from 'node:path';
import type { Db } from '../persistence/db.ts';
import {
  recordNativeReportedUsage,
  recordNativeTurnUsage,
} from '../persistence/native-terminal-usage.ts';
import { claudeTranscriptParser } from './claude-transcript.ts';
import { codexRolloutParser } from './codex-rollout.ts';
import type { LiveSession } from './native-runtime-types.ts';
import type { TranscriptWatcher, WatchTranscript } from './native-tail.ts';
import type { ReportedUsage, TranscriptParser, TranscriptRecord } from './native-transcript.ts';
import { createTurnUsage, type TurnUsage } from './turn-usage.ts';

export interface SessionTranscript {
  path: string;
  parser: TranscriptParser;
  offset: number | null;
  watcher: TranscriptWatcher | null;
  turn: TurnUsage;
  turnChanged: boolean;
  reported: ReportedUsage | null;
  model: string | null;
  agents: Map<string, TranscriptWatcher>;
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
  const counted = (
    session: LiveSession,
    transcript: SessionTranscript,
    record: TranscriptRecord,
  ) => {
    if (record.kind !== 'response' || !session.context) return false;
    if (record.turnId !== null && record.turnId !== session.row.native_turn_id) return false;
    if (!transcript.turn.add({ ...record, model: record.model ?? transcript.model })) return false;
    transcript.turnChanged = true;
    return true;
  };
  const saveLater = (session: LiveSession) => enqueue(session, () => saveQuietly(session));
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
        if (counted(session, transcript, record)) changed = true;
      }
      return Promise.all([
        ...interrupted.map((turnId) => onInterrupt?.(session, turnId)),
        changed ? saveLater(session) : undefined,
      ]).then(() => undefined);
    });
  const closeAgents = async (transcript: SessionTranscript) => {
    const agents = [...transcript.agents.values()];
    transcript.agents.clear();
    await Promise.all(agents.map((agent) => agent.flush()));
    for (const agent of agents) agent.close();
  };
  return {
    follow(session: LiveSession, path: string, model: string | null, onInterrupt: OnInterrupt) {
      const provider = session.row.provider;
      if (session.transcript?.path !== path) {
        session.transcript?.watcher?.close();
        session.transcript = {
          path,
          parser: provider === 'claude' ? claudeTranscriptParser() : codexRolloutParser(),
          offset: null,
          watcher: null,
          turn: createTurnUsage(provider),
          turnChanged: false,
          reported: null,
          model,
          agents: new Map(),
        };
      }
      const transcript = session.transcript;
      transcript.model = model ?? transcript.model;
      transcript.watcher ??= open(session, transcript, onInterrupt);
    },
    followAgent(session: LiveSession, path: string) {
      const transcript = session.transcript;
      if (!transcript?.watcher || transcript.agents.has(path)) return;
      const parser =
        session.row.provider === 'claude' ? claudeTranscriptParser(true) : codexRolloutParser();
      const watcher = watch(path, 0, async (lines) => {
        const records = lines.flatMap((line) => parser.push(line));
        const changed = records.filter((record) => counted(session, transcript, record));
        if (changed.length > 0) await saveLater(session);
      });
      if (watcher) transcript.agents.set(path, watcher);
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
      await closeAgents(transcript);
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
