import { basename } from 'node:path';
import type { Db } from '../persistence/db.ts';
import {
  recordNativeReportedUsage,
  recordNativeTurnUsage,
  recordNativeUsageOffset,
} from '../persistence/native-terminal-usage.ts';
import { claudeTranscriptParser } from './claude-transcript.ts';
import { codexRolloutParser } from './codex-rollout.ts';
import type { LiveSession } from './native-runtime-types.ts';
import type { TranscriptWatcher, WatchTranscript } from './native-tail.ts';
import type { ReportedUsage, TranscriptParser, TranscriptRecord } from './native-transcript.ts';
import { createTurnUsage, type TurnUsage } from './turn-usage.ts';

const KEPT_TURNS = 64;

interface TurnEntry {
  runId: string;
  usage: TurnUsage;
  changed: boolean;
}

export interface SessionTranscript {
  path: string;
  parser: TranscriptParser;
  offset: number | null;
  resumed: boolean;
  watcher: TranscriptWatcher | null;
  turns: Map<string, TurnEntry>;
  agentTurns: Map<string, string>;
  agents: Map<string, TranscriptWatcher>;
  reported: ReportedUsage | null;
  model: string | null;
}

type Enqueue = <T>(session: LiveSession, work: () => Promise<T>) => Promise<T>;
type OnInterrupt = (session: LiveSession, nativeTurnId: string) => Promise<void>;

function storedOffset(session: LiveSession, path: string): number | null {
  const { usage_file: file, usage_offset: offset } = session.row;
  if (file !== basename(path) || offset === null || offset === undefined) return null;
  const position = Number(offset);
  return Number.isSafeInteger(position) && position >= 0 ? position : null;
}

function openTurn(session: LiveSession, transcript: SessionTranscript): string | null {
  const turnId = session.row.native_turn_id;
  if (!session.context || !turnId) return null;
  if (!transcript.turns.has(turnId)) {
    transcript.turns.set(turnId, {
      runId: session.context.input.identity.runId,
      usage: createTurnUsage(session.row.provider),
      changed: false,
    });
    if (transcript.turns.size > KEPT_TURNS)
      transcript.turns.delete(transcript.turns.keys().next().value!);
  }
  return turnId;
}

function reportedHere(path: string, usage: ReportedUsage): boolean {
  return basename(path) === `${usage.nativeSessionId}.jsonl`;
}

export function nativeUsage(db: Db, watch: WatchTranscript, enqueue: Enqueue) {
  const save = async (session: LiveSession) => {
    const transcript = session.transcript;
    if (!transcript) return;
    for (const turn of transcript.turns.values()) {
      const totals = turn.changed ? turn.usage.totals() : null;
      turn.changed = false;
      if (totals) await recordNativeTurnUsage(db, turn.runId, totals);
    }
    const reported = transcript.reported;
    transcript.reported = null;
    if (reported) await recordNativeReportedUsage(db, session.row.id, reported);
  };
  const saveQuietly = (session: LiveSession) => save(session).catch(() => undefined);
  const saveLater = (session: LiveSession) => enqueue(session, () => saveQuietly(session));
  const keepOffset = async (session: LiveSession, transcript: SessionTranscript) => {
    const offset = transcript.watcher?.offset() ?? null;
    if (offset === null) return;
    transcript.offset = offset;
    session.row.usage_file = basename(transcript.path);
    session.row.usage_offset = offset;
    await recordNativeUsageOffset(db, session.row.id, basename(transcript.path), offset).catch(
      () => undefined,
    );
  };
  const counted = (
    session: LiveSession,
    transcript: SessionTranscript,
    record: TranscriptRecord,
  ) => {
    if (record.kind !== 'response') return false;
    const turnId = record.turnId ?? (transcript.resumed ? null : openTurn(session, transcript));
    const turn = turnId ? transcript.turns.get(turnId) : undefined;
    if (!turn?.usage.add({ ...record, model: record.model ?? transcript.model })) return false;
    turn.changed = true;
    return true;
  };
  const open = (session: LiveSession, transcript: SessionTranscript, onInterrupt?: OnInterrupt) =>
    watch(transcript.path, transcript.offset, (lines) => {
      const interrupted: string[] = [];
      let changed = false;
      for (const record of lines.flatMap((line) => transcript.parser.push(line))) {
        if (record.kind === 'interrupt') interrupted.push(record.turnId);
        if (record.kind === 'agent') transcript.agentTurns.set(record.agentId, record.turnId);
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
  const flushAgents = (transcript: SessionTranscript) =>
    Promise.all([...transcript.agents.values()].map((agent) => agent.flush()));
  return {
    follow(session: LiveSession, path: string, model: string | null, onInterrupt: OnInterrupt) {
      const provider = session.row.provider;
      if (session.transcript?.path !== path) {
        session.transcript?.watcher?.close();
        for (const agent of session.transcript?.agents.values() ?? []) agent.close();
        const offset = storedOffset(session, path);
        session.transcript = {
          path,
          parser: provider === 'claude' ? claudeTranscriptParser() : codexRolloutParser(),
          offset,
          resumed: offset !== null,
          watcher: null,
          turns: new Map(),
          agentTurns: new Map(),
          agents: new Map(),
          reported: null,
          model,
        };
      }
      const transcript = session.transcript;
      transcript.model = model ?? transcript.model;
      openTurn(session, transcript);
      transcript.watcher ??= open(session, transcript, onInterrupt);
    },
    agentRun(session: LiveSession, agentId: string): string | null {
      const transcript = session.transcript;
      if (!transcript) return null;
      const started = openTurn(session, transcript);
      if (started && !transcript.agentTurns.has(agentId))
        transcript.agentTurns.set(agentId, started);
      return transcript.turns.get(transcript.agentTurns.get(agentId) ?? '')?.runId ?? null;
    },
    followAgent(session: LiveSession, path: string) {
      const transcript = session.transcript;
      if (!transcript || transcript.agents.has(path)) return;
      const parser =
        session.row.provider === 'claude' ? claudeTranscriptParser(true) : codexRolloutParser();
      const watcher = watch(path, 0, async (lines) => {
        const records = lines.flatMap((line) => parser.push(line));
        const changed = records.filter((record) => counted(session, transcript, record));
        if (changed.length > 0) await saveLater(session);
      });
      if (watcher) transcript.agents.set(path, watcher);
    },
    async endAgent(session: LiveSession, path: string) {
      const agent = session.transcript?.agents.get(path);
      if (!agent) return;
      await agent.flush();
      agent.close();
      session.transcript?.agents.delete(path);
      await saveQuietly(session);
    },
    async settle(session: LiveSession) {
      const transcript = session.transcript;
      if (!transcript) return;
      if (transcript.watcher) {
        await transcript.watcher.flush();
        await keepOffset(session, transcript);
        transcript.watcher.close();
        transcript.watcher = null;
      }
      await flushAgents(transcript);
      await saveQuietly(session);
    },
    async last(session: LiveSession) {
      const transcript = session.transcript;
      if (!transcript) return;
      transcript.watcher ??= open(session, transcript);
      await transcript.watcher?.ready;
      await this.settle(session);
      for (const agent of transcript.agents.values()) agent.close();
      transcript.agents.clear();
    },
  };
}

export type NativeUsage = ReturnType<typeof nativeUsage>;
