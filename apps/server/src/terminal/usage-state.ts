import { statSync } from 'node:fs';
import type { LiveSession } from './native-runtime-types.ts';
import type { TranscriptWatcher } from './native-tail.ts';
import type { ReportedUsage, TranscriptParser, TranscriptRecord } from './native-transcript.ts';
import { createTurnUsage, type TurnUsage } from './turn-usage.ts';

const KEPT_TURNS = 64;

type Response = Extract<TranscriptRecord, { kind: 'response' }>;

interface TurnEntry {
  runId: string;
  usage: TurnUsage;
  changed: boolean;
}

export interface SessionTranscript {
  path: string;
  parser: TranscriptParser;
  offset: number;
  resumed: boolean;
  catchUp: boolean;
  watcher: TranscriptWatcher | null;
  turns: Map<string, TurnEntry>;
  held: Map<string, Response[]>;
  prompts: Map<string, { human: boolean; owner: string | null }>;
  agentTurns: Map<string, string>;
  waiting: Set<string>;
  agents: Map<string, TranscriptWatcher>;
  reported: ReportedUsage | null;
  model: string | null;
  previous: SessionTranscript | null;
}

function trim<T>(map: Map<string, T>): void {
  if (map.size > KEPT_TURNS) map.delete(map.keys().next().value!);
}

export function firstPosition(
  session: LiveSession,
  path: string,
): { offset: number; resumed: boolean } {
  const { usage_file: file, usage_offset: stored } = session.row;
  const position = file === path && stored !== null && stored !== undefined ? Number(stored) : -1;
  if (Number.isSafeInteger(position) && position >= 0) return { offset: position, resumed: true };
  try {
    return { offset: statSync(path).size, resumed: false };
  } catch {
    return { offset: 0, resumed: false };
  }
}

export function openTurn(session: LiveSession, transcript: SessionTranscript): string | null {
  const turnId = session.row.native_turn_id;
  if (!session.context || !turnId) return null;
  if (transcript.turns.has(turnId)) return turnId;
  const turn: TurnEntry = {
    runId: session.context.input.identity.runId,
    usage: createTurnUsage(session.row.provider),
    changed: false,
  };
  for (const response of transcript.held.get(turnId) ?? [])
    if (turn.usage.add(response)) turn.changed = true;
  transcript.held.delete(turnId);
  transcript.turns.set(turnId, turn);
  trim(transcript.turns);
  return turnId;
}

function owningTurn(
  session: LiveSession,
  transcript: SessionTranscript,
  response: Response,
): string | null {
  const named = response.turnId ?? (transcript.resumed ? null : openTurn(session, transcript));
  const known = named ? transcript.prompts.get(named) : undefined;
  return known && !known.human && known.owner ? known.owner : named;
}

export function count(
  session: LiveSession,
  transcript: SessionTranscript,
  record: TranscriptRecord,
): boolean {
  if (record.kind !== 'response') return false;
  const response = { ...record, model: record.model ?? transcript.model };
  const turnId = owningTurn(session, transcript, response);
  if (!turnId) return false;
  const turn = transcript.turns.get(turnId);
  if (!turn) {
    transcript.held.set(turnId, [...(transcript.held.get(turnId) ?? []), response]);
    trim(transcript.held);
    return false;
  }
  if (!turn.usage.add(response)) return false;
  turn.changed = true;
  return true;
}

export function note(
  transcript: SessionTranscript,
  record: TranscriptRecord,
  fileAgent: string | null,
): void {
  if (record.kind === 'agent') {
    transcript.agentTurns.set(record.agentId, record.turnId);
    transcript.waiting.add(record.agentId);
  }
  if (record.kind !== 'prompt') return;
  transcript.prompts.set(record.promptId, { human: record.human, owner: record.owner });
  trim(transcript.prompts);
  const agent = record.agentId ?? fileAgent;
  if (!record.human && agent) transcript.waiting.delete(agent);
}

export function stepRun(transcript: SessionTranscript, turnId: string | null): string | null {
  const known = turnId ? transcript.prompts.get(turnId) : undefined;
  const owner = known && !known.human && known.owner ? known.owner : turnId;
  return (owner && transcript.turns.get(owner)?.runId) || null;
}

export function chain(transcript: SessionTranscript | null): SessionTranscript[] {
  return transcript ? [transcript, ...chain(transcript.previous)] : [];
}

export function moveToOwner(
  transcript: SessionTranscript,
  promptId: string,
): { runId: string; ownerRunId: string } | null {
  const known = transcript.prompts.get(promptId);
  const turn = transcript.turns.get(promptId);
  const owner = known && !known.human && known.owner ? transcript.turns.get(known.owner) : null;
  if (!turn || !owner || owner === turn) return null;
  for (const response of turn.usage.take()) if (owner.usage.add(response)) owner.changed = true;
  transcript.turns.delete(promptId);
  return { runId: turn.runId, ownerRunId: owner.runId };
}
