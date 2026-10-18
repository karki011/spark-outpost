import { basename } from 'node:path';
import type { Db } from '../persistence/db.ts';
import type { NativeTerminalRow } from '../persistence/native-terminals.ts';
import { recordNativeStep } from '../persistence/native-terminal-steps.ts';
import {
  recordNativeReportedUsage,
  recordNativeTurnUsage,
  recordNativeUsageOffset,
} from '../persistence/native-terminal-usage.ts';
import { recordLongWrites, recordSessionCacheTtl } from '../persistence/prompt-cache.ts';
import { claudeTranscriptParser } from './claude-transcript.ts';
import { saveModUsage } from './mod-telemetry.ts';
import { codexRolloutParser } from './codex-rollout.ts';
import type { LiveSession } from './native-runtime-types.ts';
import type { WatchTranscript } from './native-tail.ts';
import type { ReportedUsage } from './native-transcript.ts';
import {
  chain,
  count,
  firstPosition,
  moveToOwner,
  note,
  noteCacheTtl,
  openTurn,
  stepRun,
  type SessionTranscript,
} from './usage-state.ts';

export type { SessionTranscript } from './usage-state.ts';

type Enqueue = <T>(session: LiveSession, work: () => Promise<T>) => Promise<T>;
type OnInterrupt = (session: LiveSession, nativeTurnId: string) => Promise<void>;
type OnNotTyped = (session: LiveSession, promptId: string) => Promise<void>;

function reportedHere(path: string, usage: ReportedUsage): boolean {
  return basename(path) === `${usage.nativeSessionId}.jsonl`;
}

async function saveCacheTtl(db: Db, session: LiveSession): Promise<void> {
  const transcript = session.transcript;
  const ttl = transcript?.cacheTtl ?? null;
  if (!transcript || ttl === null || ttl === transcript.savedTtl) return;
  await recordSessionCacheTtl(db, session.row.id, ttl);
  transcript.savedTtl = ttl;
}

export function nativeUsage(db: Db, watch: WatchTranscript, enqueue: Enqueue) {
  const caughtUp = new Set<string>();
  let notTyped: OnNotTyped = async () => undefined;
  const save = async (session: LiveSession) => {
    await saveCacheTtl(db, session);
    for (const transcript of chain(session.transcript)) {
      for (const turn of transcript.turns.values()) {
        if (!turn.changed) continue;
        turn.changed = false;
        const totals = turn.usage.totals();
        if (totals) await recordNativeTurnUsage(db, turn.runId, totals);
        if (await recordLongWrites(db, turn.runId, turn.usage.longWrites()))
          await saveModUsage(db, turn.runId);
      }
      const reported = transcript.reported;
      transcript.reported = null;
      if (reported) await recordNativeReportedUsage(db, session.row.id, reported);
    }
  };
  const saveQuietly = (session: LiveSession) => save(session).catch(() => undefined);
  const saveLater = (session: LiveSession) => enqueue(session, () => saveQuietly(session));
  const open = (session: LiveSession, transcript: SessionTranscript, onInterrupt?: OnInterrupt) =>
    watch(transcript.path, transcript.offset, (lines) => {
      const interrupted: string[] = [];
      const retracted: string[] = [];
      const missed: (() => Promise<void>)[] = [];
      let changed = false;
      for (const record of lines.flatMap((line) => transcript.parser.push(line))) {
        note(transcript, record, null);
        const runId =
          record.kind === 'step' && transcript.catchUp ? stepRun(transcript, record.turnId) : null;
        if (record.kind === 'step' && runId) {
          const at = record.at ? new Date(record.at) : null;
          const step = {
            id: record.id,
            name: record.name,
            phase: record.phase,
            failed: record.failed,
          };
          missed.push(() =>
            recordNativeStep(db, runId, at && !Number.isNaN(at.getTime()) ? { ...step, at } : step),
          );
        }
        if (record.kind === 'prompt' && !record.human && transcript.turns.has(record.promptId))
          retracted.push(record.promptId);
        if (record.kind === 'interrupt') interrupted.push(record.turnId);
        if (record.kind === 'reported' && reportedHere(transcript.path, record.usage)) {
          transcript.reported = record.usage;
          changed = true;
        }
        if (count(session, transcript, record)) changed = true;
        if (noteCacheTtl(transcript, record)) changed = true;
      }
      return Promise.all([
        missed.reduce((before, record) => before.then(record), Promise.resolve()),
        ...interrupted.map((turnId) => onInterrupt?.(session, turnId)),
        ...retracted.map((promptId) => notTyped(session, promptId)),
        changed ? saveLater(session) : undefined,
      ]).then(() => undefined);
    });
  const read = async (session: LiveSession, transcript: SessionTranscript) => {
    const watching = transcript.watcher !== null;
    const watcher = transcript.watcher ?? open(session, transcript);
    if (!watcher) return;
    await (watching ? watcher.flush() : watcher.ready);
    const offset = watcher.offset();
    if (!watching) watcher.close();
    if (offset === null || offset === transcript.offset) return;
    transcript.offset = offset;
    if (transcript !== session.transcript) return;
    session.row.usage_file = transcript.path;
    session.row.usage_offset = offset;
    await recordNativeUsageOffset(db, session.row.id, transcript.path, offset).catch(
      () => undefined,
    );
  };
  const readAll = async (session: LiveSession) => {
    for (const transcript of chain(session.transcript)) {
      await read(session, transcript);
      await Promise.all([...transcript.agents.values()].map((agent) => agent.flush()));
    }
  };
  const start = (
    session: LiveSession,
    path: string,
    model: string | null,
    openTurnId: string | null,
  ): SessionTranscript => {
    const previous = session.transcript;
    previous?.watcher?.close();
    if (previous) previous.watcher = null;
    return {
      path,
      parser:
        session.row.provider === 'claude'
          ? claudeTranscriptParser(false, openTurnId)
          : codexRolloutParser(),
      ...firstPosition(session, path),
      catchUp: false,
      watcher: null,
      turns: new Map(),
      held: new Map(),
      prompts: new Map(),
      agentTurns: new Map(),
      waiting: new Set(),
      agents: new Map(),
      reported: null,
      model,
      cacheTtl: null,
      savedTtl: null,
      previous,
    };
  };
  return {
    follow(session: LiveSession, path: string, model: string | null, onInterrupt: OnInterrupt) {
      if (session.transcript?.path !== path) {
        const started = start(session, path, model, null);
        session.transcript = started;
        const earlier = started.previous;
        if (earlier) void read(session, earlier).then(() => saveLater(session));
        if (!started.resumed) {
          session.row.usage_file = path;
          session.row.usage_offset = started.offset;
          void enqueue(session, () =>
            recordNativeUsageOffset(db, session.row.id, path, started.offset),
          ).catch(() => undefined);
        }
      }
      const transcript = session.transcript;
      transcript.model = model ?? transcript.model;
      openTurn(session, transcript);
      transcript.watcher ??= open(session, transcript, onInterrupt);
    },
    resume(session: LiveSession, onInterrupt: OnInterrupt): boolean {
      const path = session.row.usage_file;
      if (!path || !session.context || session.transcript) return false;
      const transcript = start(session, path, null, session.row.native_turn_id);
      session.transcript = transcript;
      transcript.catchUp = session.row.provider === 'claude';
      openTurn(session, transcript);
      transcript.watcher = open(session, transcript, onInterrupt);
      void transcript.watcher?.ready.then(() => {
        transcript.catchUp = false;
      });
      return transcript.catchUp && transcript.watcher !== null;
    },
    agentRun(session: LiveSession, agentId: string): string | null {
      const transcript = session.transcript;
      if (!transcript) return null;
      const started = openTurn(session, transcript);
      if (started && !transcript.agentTurns.has(agentId)) {
        transcript.agentTurns.set(agentId, started);
        transcript.waiting.add(agentId);
      }
      return transcript.turns.get(transcript.agentTurns.get(agentId) ?? '')?.runId ?? null;
    },
    ownerRun(session: LiveSession, promptId: string): string | null {
      const transcript = session.transcript;
      const owner = transcript?.prompts.get(promptId)?.owner;
      return (owner && transcript?.turns.get(owner)?.runId) || null;
    },
    promptRun(session: LiveSession, promptId: string): string | null {
      for (const transcript of chain(session.transcript)) {
        const runId = stepRun(transcript, promptId);
        if (runId) return runId;
      }
      const open = session.context && session.row.native_turn_id === promptId;
      return open ? session.context!.input.identity.runId : null;
    },
    onNotTyped(handler: OnNotTyped) {
      notTyped = handler;
    },
    moveToOwner(session: LiveSession, promptId: string) {
      return session.transcript ? moveToOwner(session.transcript, promptId) : null;
    },
    typedByUser(session: LiveSession, promptId: string): boolean | null {
      return session.transcript?.prompts.get(promptId)?.human ?? null;
    },
    followAgent(session: LiveSession, path: string, agentId: string | null) {
      const transcript = session.transcript;
      if (!transcript || transcript.agents.has(path)) return;
      const parser =
        session.row.provider === 'claude' ? claudeTranscriptParser(true) : codexRolloutParser();
      const watcher = watch(path, 0, async (lines) => {
        const records = lines.flatMap((line) => parser.push(line));
        for (const record of records) note(transcript, record, agentId);
        const changed = records.filter((record) => count(session, transcript, record));
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
    saveNow: saveQuietly,
    async settle(session: LiveSession) {
      const transcript = session.transcript;
      if (!transcript) return;
      await readAll(session);
      transcript.watcher?.close();
      transcript.watcher = null;
      await saveQuietly(session);
    },
    async last(session: LiveSession) {
      await this.settle(session);
      for (const transcript of chain(session.transcript)) {
        for (const agent of transcript.agents.values()) agent.close();
        transcript.agents.clear();
      }
    },
    async catchUpStored(row: NativeTerminalRow) {
      const { usage_file: path, usage_offset: stored } = row;
      if (caughtUp.has(row.id) || !path || stored === null || stored === undefined) return;
      caughtUp.add(row.id);
      const parser = row.provider === 'claude' ? claudeTranscriptParser() : codexRolloutParser();
      let reported: ReportedUsage | null = null;
      const watcher = watch(path, Number(stored), async (lines) => {
        for (const record of lines.flatMap((line) => parser.push(line)))
          if (record.kind === 'reported' && reportedHere(path, record.usage))
            reported = record.usage;
      });
      if (!watcher) return;
      await watcher.ready;
      const offset = watcher.offset();
      watcher.close();
      if (reported) await recordNativeReportedUsage(db, row.id, reported);
      if (offset !== null && offset !== Number(stored))
        await recordNativeUsageOffset(db, row.id, path, offset);
    },
  };
}

export type NativeUsage = ReturnType<typeof nativeUsage>;
