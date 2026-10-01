import { matchesGlob } from 'node:path';
import { nextCrewName, piecesBlockSchema, type PieceList } from '@spark-outpost/contracts';
import { insertPieceList } from '../persistence/pieces.ts';
import { proposedPlanFromRun, rejectPlanDocument } from '../persistence/plan-documents.ts';
import { usedNames } from '../persistence/orchestrations.ts';
import { isSecretPath } from '../projects/path-policy.ts';
import { agreedPlanText, checkCommands } from '../orchestration/member-prompts.ts';
import { runMember } from '../orchestration/members.ts';
import { seatRoute } from '../orchestration/member-routes.ts';
import type { MemberResult, Seat, Session } from '../orchestration/session.ts';
import type { Assessment } from './assess.ts';
import { assignPieces } from './assign.ts';
import { likelyFiles } from './engage.ts';
import { assignFacts } from './provider-state.ts';
import { isGlob, normalizeOwned, type OwnedSet } from './owned.ts';
import { routePieces } from './piece-jev.ts';
import { piecesHash, validatePieces, type CheckedPieces } from './pieces-validate.ts';
import type { PlanStep } from './plan-coverage.ts';
import { budgetFor, lineCounter, projectFiles } from './project-facts.ts';
import { chooseListPlace, wantsListCard } from './place-list.ts';
import { coordinatorPrompt, piecesBlockText, repairPrompt } from './prompts.ts';

const LIKELY_SHOWN = 15;
const PLAN_FILES_SHOWN = 30;
const spawn = {
  role: 'coordinator' as const,
  reason: 'first' as const,
  escalate: false,
  note: null,
};

export interface WrittenList {
  list: PieceList;
  owned: Map<string, OwnedSet>;
  names: Map<string, string>;
  topTier: Set<string>;
}

export type PieceListResult = { ok: true; value: WrittenList } | { ok: false; reason: string };

function coordinatorKey(taskId: string): string {
  return `${taskId}:coordinator`;
}

async function coordinatorSeat(s: Session, prompt: string): Promise<Seat> {
  const used = await usedNames(s.deps.db, s.taskId!, 'coordinator');
  return {
    role: 'coordinator',
    name: used[0] ?? nextCrewName('coordinator', used),
    resumeKey: coordinatorKey(s.taskId!),
    prompt,
  };
}

function pathsNamed(block: unknown, files: readonly string[]): string[] {
  const parsed = piecesBlockSchema.safeParse(block);
  if (!parsed.success) return [];
  const named = parsed.data.pieces.flatMap((piece) => [...piece.owns, ...piece.reads]);
  return named.flatMap((raw) => {
    const path = normalizeOwned(raw);
    if (!path) return [];
    return isGlob(path) ? files.filter((file) => matchesGlob(file, path)) : [path];
  });
}

async function replyText(s: Session, result: MemberResult): Promise<string> {
  if (piecesBlockText(result.text) !== null) return result.text;
  const proposed = await proposedPlanFromRun(s.deps.db, result.runId);
  if (!proposed) return result.text;
  await rejectPlanDocument(s.deps.db, proposed.id, null).catch(() => null);
  return proposed.body;
}

async function checkBlock(
  s: Session,
  text: string,
  facts: { files: string[]; budgetTokens: number; planSteps: readonly PlanStep[] },
) {
  const block = piecesBlockText(text);
  if (block === null) return { ok: false as const, errors: ['the reply has no JSON pieces block'] };
  const root = s.input.projectRoots[0]!;
  return validatePieces(block, {
    files: facts.files,
    isSecret: (path) => isSecretPath(path),
    lines: await lineCounter(root, pathsNamed(block, facts.files)),
    budgetTokens: facts.budgetTokens,
    projectChecks: checkCommands(s),
    planSteps: facts.planSteps,
  });
}

function withRevision(prompt: string, note: string | null): string {
  return note ? `${prompt}\n\n## The user asked for changes to the split\n${note}` : prompt;
}

async function askForPieces(
  s: Session,
  assessment: Assessment,
  note: string | null,
): Promise<{ ok: true; value: CheckedPieces } | { ok: false; reason: string }> {
  const root = s.input.projectRoots[0]!;
  const files = await projectFiles(root);
  const budgetTokens = budgetFor(seatRoute(s, spawn).route.pick);
  const likely = likelyFiles(s.scanReport?.candidates ?? []).slice(0, LIKELY_SHOWN);
  let prompt = withRevision(
    coordinatorPrompt({
      request: s.input.userRequest,
      agreedPlan: await agreedPlanText(s),
      likelyFiles: likely.map((file) => ({ path: file.path, lines: file.lines })),
      planFiles: [...new Set(assessment.planSteps.flatMap((step) => step.files))].slice(
        0,
        PLAN_FILES_SHOWN,
      ),
      checks: checkCommands(s),
      budgetTokens,
    }),
    note,
  );
  let errors: string[] = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) prompt = repairPrompt(prompt, errors);
    const { result } = await runMember(s, spawn, null, { seat: await coordinatorSeat(s, prompt) });
    if (result.outcome !== 'succeeded') {
      return { ok: false, reason: result.error ?? `the coordinator turn ${result.outcome}` };
    }
    const checked = await checkBlock(s, await replyText(s, result), {
      files,
      budgetTokens,
      planSteps: assessment.planSteps,
    });
    if (checked.ok) return checked;
    errors = checked.errors;
  }
  return {
    ok: false,
    reason: `the piece list was still invalid: ${errors.slice(0, 3).join('; ')}`,
  };
}

async function builderNames(s: Session, keys: readonly string[]): Promise<Map<string, string>> {
  const used = await usedNames(s.deps.db, s.taskId!, 'builder');
  const names = new Map<string, string>();
  for (const key of keys) {
    const name = nextCrewName('builder', [...used, ...names.values()]);
    names.set(key, name);
  }
  return names;
}

export async function writePieceList(
  s: Session,
  assessment: Assessment,
  note: string | null = null,
): Promise<PieceListResult> {
  const asked = await askForPieces(s, assessment, note);
  if (!asked.ok) return asked;
  const { pieces, integration } = asked.value;
  const place = await chooseListPlace(s, pieces);
  const facts = await assignFacts(s, place.placement !== 'in_order');
  const assigned = new Map(assignPieces(pieces, facts).map((entry) => [entry.key, entry.pick]));
  const routed = await routePieces(s, pieces, place, assigned, facts);
  const routes = new Map(routed.pieces.map((route) => [route.key, route]));
  const list = await insertPieceList(s.deps.db, {
    taskId: s.taskId!,
    orchestrationRunId: s.lease.runId,
    planDocumentId: assessment.plan?.id ?? null,
    planVersion: assessment.plan?.version ?? null,
    piecesHash: piecesHash(pieces),
    placement: routed.placement,
    placementReason: routed.reason,
    integration,
    approvedBy: wantsListCard(s, routed.placement, pieces.length) ? null : 'level',
    pieces: pieces.map((piece) => ({
      ...piece,
      owns: [...piece.owned.paths, ...piece.owned.globs],
      placement: routes.get(piece.key)!.place.placement,
      provider: routes.get(piece.key)!.model.pick.provider,
      model: routes.get(piece.key)!.model.pick.model,
      pickNote: routed.notes.get(piece.key) ?? null,
    })),
  });
  return {
    ok: true,
    value: {
      list,
      owned: new Map(pieces.map((piece) => [piece.key, piece.owned])),
      names: await builderNames(
        s,
        pieces.map((piece) => piece.key),
      ),
      topTier: new Set(
        routed.pieces
          .filter((route) => route.model.demand?.tier === 'top')
          .map((route) => route.key),
      ),
    },
  };
}
