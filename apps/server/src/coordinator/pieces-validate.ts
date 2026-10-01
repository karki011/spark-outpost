import { createHash } from 'node:crypto';
import { matchesGlob } from 'node:path';
import { piecesBlockSchema, type PieceDraft } from '@spark-outpost/contracts';
import { COORD_MAX_PIECES } from '../advisor/policy.ts';
import { findCycle, reaches, type Graph } from './graph.ts';
import { isGlob, normalizeOwned, owns, sharedFiles, type OwnedSet } from './owned.ts';
import { uncoveredSteps, type PlanStep } from './plan-coverage.ts';
import { docsOnly, scopedCheckProblem } from './scoped-checks.ts';
import { sizeEstimate, type LineCount } from './size.ts';

export interface ValidationFacts {
  files: readonly string[];
  isSecret: (relative: string) => boolean;
  lines: LineCount;
  budgetTokens: number;
  projectChecks: readonly string[];
  planSteps: readonly PlanStep[];
}

export interface CheckedPiece extends PieceDraft {
  owned: OwnedSet;
  sizeEstimate: number;
}

export interface CheckedPieces {
  pieces: CheckedPiece[];
  integration: string | null;
}

export type Validation = { ok: true; value: CheckedPieces } | { ok: false; errors: string[] };

function folders(files: readonly string[]): Set<string> {
  const found = new Set<string>();
  for (const file of files) {
    const parts = file.split('/');
    for (let end = 1; end < parts.length; end += 1) found.add(parts.slice(0, end).join('/'));
  }
  return found;
}

function underKnownFolder(path: string, known: ReadonlySet<string>): boolean {
  const parts = path.split('/');
  if (parts.length === 1) return true;
  return parts.slice(0, -1).some((_, index) => known.has(parts.slice(0, index + 1).join('/')));
}

function ownedSet(
  piece: PieceDraft,
  facts: ValidationFacts,
  known: ReadonlySet<string>,
  errors: string[],
): OwnedSet {
  const paths = new Set<string>();
  const globs: string[] = [];
  for (const raw of piece.owns) {
    const path = normalizeOwned(raw);
    if (!path) {
      errors.push(`${piece.key} owns \`${raw}\`, which is not a path inside the project`);
      continue;
    }
    if (path === '.git' || path.startsWith('.git/')) {
      errors.push(`${piece.key} owns \`${path}\` inside .git`);
      continue;
    }
    if (facts.isSecret(path)) {
      errors.push(`${piece.key} owns \`${path}\`, a secret file`);
      continue;
    }
    if (!isGlob(path)) {
      if (!facts.files.includes(path) && !underKnownFolder(path, known)) {
        errors.push(`${piece.key} owns \`${path}\`, which is not under any folder in the project`);
      }
      paths.add(path);
      continue;
    }
    const matched = facts.files.filter((file) => matchesGlob(file, path));
    matched.forEach((file) => paths.add(file));
    globs.push(path);
  }
  return { paths: [...paths], globs };
}

function ordered(graph: Graph, a: string, b: string): boolean {
  return reaches(graph, a, b) || reaches(graph, b, a);
}

function graphErrors(drafts: readonly PieceDraft[], errors: string[]): Map<string, string[]> {
  const keys = new Set<string>();
  for (const piece of drafts) {
    if (keys.has(piece.key)) errors.push(`piece key ${piece.key} is used twice`);
    keys.add(piece.key);
  }
  const graph = new Map<string, string[]>();
  for (const piece of drafts) {
    const deps = [...new Set(piece.dependsOn)];
    for (const dep of deps) {
      if (dep === piece.key) errors.push(`${piece.key} depends on itself`);
      else if (!keys.has(dep)) errors.push(`${piece.key} depends on ${dep}, which is not a piece`);
    }
    graph.set(
      piece.key,
      deps.filter((dep) => dep !== piece.key && keys.has(dep)),
    );
  }
  const cycle = findCycle([...keys], graph);
  if (cycle) errors.push(`dependsOn has a cycle: ${cycle.join(' → ')}`);
  return graph;
}

function ownershipErrors(
  pieces: readonly CheckedPiece[],
  graph: Map<string, string[]>,
  errors: string[],
): void {
  for (let a = 0; a < pieces.length; a += 1) {
    for (let b = a + 1; b < pieces.length; b += 1) {
      const left = pieces[a]!;
      const right = pieces[b]!;
      const shared = sharedFiles(left.owned, right.owned);
      if (shared.length > 0 && !ordered(graph, left.key, right.key)) {
        errors.push(
          `${left.key} and ${right.key} both own ${shared.slice(0, 3).join(', ')}; make one depend on the other`,
        );
      }
    }
  }
  for (const reader of pieces) {
    for (const read of reader.reads) {
      const owner = pieces.find((piece) => piece !== reader && owns(piece.owned, read));
      if (!owner || reaches(graph, reader.key, owner.key)) continue;
      if (reaches(graph, owner.key, reader.key)) {
        errors.push(
          `${reader.key} reads ${read}, which ${owner.key} owns, but ${owner.key} already depends on ${reader.key}; move the shared part into one piece`,
        );
        continue;
      }
      graph.set(reader.key, [...(graph.get(reader.key) ?? []), owner.key]);
      reader.dependsOn = [...reader.dependsOn, owner.key];
    }
  }
}

function pieceErrors(piece: CheckedPiece, facts: ValidationFacts, errors: string[]): void {
  if (!piece.research && piece.owns.length === 0) {
    errors.push(`${piece.key} owns no files; only research pieces may own none`);
  }
  if (piece.research && piece.owns.length > 0) {
    errors.push(`${piece.key} is a research piece but owns files`);
  }
  if (piece.sizeEstimate > facts.budgetTokens) {
    errors.push(
      `${piece.key} is too big for one Builder (about ${Math.round(piece.sizeEstimate / 1000)}K tokens against ${Math.round(facts.budgetTokens / 1000)}K); split it`,
    );
  }
  for (const check of piece.checks) {
    const problem = scopedCheckProblem(check, facts.projectChecks);
    if (problem) errors.push(`${piece.key}'s check \`${check}\` ${problem}`);
  }
}

function docsChecks(draft: PieceDraft, facts: ValidationFacts): string[] {
  if (!docsOnly(draft.owns)) return draft.checks;
  return draft.checks.filter((check) => scopedCheckProblem(check, facts.projectChecks) === null);
}

export function validatePieces(block: unknown, facts: ValidationFacts): Validation {
  const parsed = piecesBlockSchema.safeParse(block);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    };
  }
  const drafts = parsed.data.pieces;
  const errors: string[] = [];
  if (drafts.length > COORD_MAX_PIECES) {
    errors.push(`${drafts.length} pieces; use at most ${COORD_MAX_PIECES}`);
  }
  const graph = graphErrors(drafts, errors);
  const known = folders(facts.files);
  const pieces = drafts.map((draft): CheckedPiece => {
    const owned = ownedSet(draft, facts, known, errors);
    const reads = draft.reads.flatMap((read) => normalizeOwned(read) ?? []);
    return {
      ...draft,
      checks: docsChecks(draft, facts),
      reads,
      owned,
      sizeEstimate: sizeEstimate({ owns: owned.paths, reads }, facts.lines),
    };
  });
  pieces.forEach((piece) => pieceErrors(piece, facts, errors));
  ownershipErrors(pieces, graph, errors);
  for (const step of uncoveredSteps(facts.planSteps, pieces)) {
    errors.push(`no piece covers the plan item "${step.text}"`);
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { pieces, integration: parsed.data.integration } };
}

export function piecesHash(pieces: readonly PieceDraft[]): string {
  const canonical = [...pieces]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((piece) => ({
      key: piece.key,
      owns: [...piece.owns].sort(),
      dependsOn: [...piece.dependsOn].sort(),
      contract: piece.contract,
      acceptance: piece.acceptance,
    }));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
