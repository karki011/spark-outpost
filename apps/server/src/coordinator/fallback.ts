import type { TaskPiece } from '@spark-outpost/contracts';
import { movePiece } from '../persistence/pieces.ts';
import { git, workingTree } from '../projects/snapshot.ts';
import type { Session } from '../orchestration/session.ts';
import { fallbackPick, providerOption } from './assign.ts';
import { changedFiles, type PieceSite } from './piece-run.ts';
import { assignFacts } from './provider-state.ts';
import type { Coordination } from './state.ts';

const STAT_LIMIT = 2_000;

export interface Handoff {
  from: string;
  why: string;
  files: readonly string[];
  stat: string;
  lastCheck: string | null;
  acceptance: readonly string[];
}

function bullets(items: readonly string[]): string {
  return items.map((item) => `- ${item}`).join('\n');
}

export function providerHandoffSection(handoff: Handoff): string {
  return [
    '## Handoff',
    `You take over this piece from a Builder on ${handoff.from}, which stopped (${handoff.why}). Its edits are in the tree: keep them and finish the piece.`,
    `Files changed so far:\n${bullets(handoff.files)}`,
    ...(handoff.stat ? [`Diff stat:\n\`\`\`text\n${handoff.stat}\n\`\`\``] : []),
    ...(handoff.lastCheck ? [`Last scoped check output:\n${handoff.lastCheck}`] : []),
    ...(handoff.acceptance.length > 0
      ? [`Acceptance still to meet:\n${bullets(handoff.acceptance)}`]
      : []),
  ].join('\n\n');
}

export function interruptedSection(files: readonly string[]): string {
  return [
    '## Your last turn was stopped so a note could reach you',
    `Its edits are in the tree. Files changed so far:\n${files.length > 0 ? bullets(files) : '- none'}`,
  ].join('\n\n');
}

async function diffStat(cwd: string, before: string): Promise<string> {
  const after = await workingTree(cwd).catch(() => null);
  if (!after || after === before) return '';
  const stat = await git(cwd, ['diff', '--stat', '--no-renames', '--relative', before, after]);
  return stat.trim().slice(0, STAT_LIMIT);
}

export function providerName(s: Session, provider: string | null): string {
  const found = s.route.candidates.find((candidate) => candidate.provider === provider);
  return found?.name ?? provider ?? 'the chat provider';
}

export interface MoveContext {
  piece: TaskPiece;
  coordination: Coordination;
  site: PieceSite;
  before: string | null;
  lastCheck: string | null;
}

async function handoffFor(s: Session, move: MoveContext, why: string): Promise<string | null> {
  if (!move.before) return null;
  const cwd = await move.site.cwd();
  const files = await changedFiles(cwd, move.before);
  if (files.length === 0) return null;
  return providerHandoffSection({
    from: providerName(s, move.piece.provider),
    why,
    files,
    stat: await diffStat(cwd, move.before),
    lastCheck: move.lastCheck,
    acceptance: move.piece.acceptance,
  });
}

export type Moved = { moved: true; handoff: string | null } | { moved: false; reason: string };

async function moveTo(
  s: Session,
  move: MoveContext,
  target: { provider: string; model: string | null },
  note: string,
  why: string,
): Promise<Moved> {
  const handoff = await handoffFor(s, move, why);
  await movePiece(s.deps.db, move.piece.id, ['running'], 'running', {
    provider: target.provider,
    model: target.model,
    note,
  });
  return { moved: true, handoff };
}

export async function moveAfterFailure(
  s: Session,
  move: MoveContext,
  why: string,
  tried: Set<string>,
): Promise<Moved> {
  const from = move.piece.provider ?? s.input.provider;
  tried.add(from);
  move.coordination.unhealthy.set(from, why);
  const facts = await assignFacts(s, false, move.coordination.unhealthy);
  const next = fallbackPick(facts, tried);
  const fromName = providerName(s, from);
  if (!next)
    return { moved: false, reason: `${fromName} ${why}, and no other provider can take the piece` };
  return moveTo(s, move, next.pick, `moved from ${fromName} (${why})`, why);
}

export async function moveOnRequest(
  s: Session,
  move: MoveContext,
  provider: string,
): Promise<Moved> {
  if (provider === move.piece.provider) return { moved: false, reason: 'already there' };
  const facts = await assignFacts(s, false, move.coordination.unhealthy);
  const option = providerOption(facts, provider);
  if (!option) return { moved: false, reason: `${providerName(s, provider)} can't take it now` };
  const fromName = providerName(s, move.piece.provider);
  return moveTo(s, move, option.pick, `moved from ${fromName} (you asked)`, 'you asked');
}
