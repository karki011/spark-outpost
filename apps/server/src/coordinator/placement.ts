import type { ListPlacement, PiecePlacement, PieceSize } from '@spark-outpost/contracts';
import {
  COORD_CRITICAL_PATH_SAVING,
  COORD_JEV_ACT_AT,
  COORD_LARGE_PIECE_FILES,
  COORD_LARGE_PIECE_TOKENS,
  COORD_LONG_PIECE_TOKENS,
  COORD_SPLIT_UNSURE_AT,
} from '../advisor/policy.ts';
import { reaches } from './graph.ts';
import { sharedFiles, type OwnedSet } from './owned.ts';

const MANIFEST =
  /(?:^|\/)(?:package\.json|pnpm-workspace\.yaml|Cargo\.toml|go\.mod|pyproject\.toml|setup\.(?:py|cfg)|requirements[^/]*\.txt|Pipfile|Gemfile|composer\.json|deno\.jsonc?)$/i;
const LOCKFILE =
  /(?:^|\/)(?:[^/]+\.lock|[^/]+-lock\.(?:json|ya?ml)|bun\.lockb|go\.sum|npm-shrinkwrap\.json)$/i;
const GENERATED =
  /(?:^|\/)(?:dist|build|out|generated|__generated__|coverage|\.next)\/|\.(?:gen|generated)\.[^/]+$|\.d\.ts$|\.min\.(?:js|css)$/i;
const MIGRATIONS = /(?:^|\/)(?:migrations?|migrate|db\/migrate)\//i;
const UNSURE_MARGIN = 0.1;

export function inMigrationsFolder(file: string): boolean {
  return MIGRATIONS.test(file);
}

export function sharedTreeBlocker(file: string): string | null {
  if (MANIFEST.test(file)) return 'a manifest';
  if (LOCKFILE.test(file)) return 'a lockfile';
  if (GENERATED.test(file)) return 'a generated file';
  if (inMigrationsFolder(file)) return 'a migration';
  return null;
}

export interface PlaceablePiece {
  key: string;
  owned: OwnedSet;
  dependsOn: readonly string[];
  sizeEstimate: number;
  size: PieceSize;
  research: boolean;
  destructive?: boolean;
}

export interface PlacementFacts {
  git: boolean;
  repoBusy: boolean;
  destructive: boolean;
  skipsGate: boolean;
  stableCheckout: boolean;
  wholeProjectChecks: boolean;
  splitWorthIt: number | null;
  sameFolder: number | null;
}

export type PlacementRow = 1 | 2 | 3;

export interface Placement {
  placement: ListPlacement;
  row: PlacementRow;
  reason: string;
  saving: number;
  splitUnsure: boolean;
  pieces: { key: string; placement: PiecePlacement }[];
}

function isLarge(piece: PlaceablePiece): boolean {
  return (
    piece.size === 'L' ||
    piece.sizeEstimate >= COORD_LARGE_PIECE_TOKENS ||
    piece.owned.paths.length + piece.owned.globs.length >= COORD_LARGE_PIECE_FILES
  );
}

function isLong(piece: PlaceablePiece, facts: PlacementFacts): boolean {
  return (
    piece.sizeEstimate >= COORD_LONG_PIECE_TOKENS ||
    (piece.size === 'L' && facts.wholeProjectChecks)
  );
}

function graphOf(pieces: readonly PlaceablePiece[]): Map<string, readonly string[]> {
  return new Map(pieces.map((piece) => [piece.key, piece.dependsOn]));
}

export function independent(
  a: PlaceablePiece,
  b: PlaceablePiece,
  graph: ReadonlyMap<string, readonly string[]>,
): boolean {
  if (reaches(graph, a.key, b.key) || reaches(graph, b.key, a.key)) return false;
  return sharedFiles(a.owned, b.owned).length === 0;
}

function independentLargePair(pieces: readonly PlaceablePiece[]): boolean {
  const graph = graphOf(pieces);
  const large = pieces.filter(isLarge);
  return large.some((a, index) => large.slice(index + 1).some((b) => independent(a, b, graph)));
}

export function criticalPathSaving(pieces: readonly PlaceablePiece[]): number {
  const total = pieces.reduce((sum, piece) => sum + piece.sizeEstimate, 0);
  if (total === 0) return 0;
  const byKey = new Map(pieces.map((piece) => [piece.key, piece]));
  const longest = new Map<string, number>();
  const chain = (key: string, seen: ReadonlySet<string>): number => {
    const known = longest.get(key);
    if (known !== undefined) return known;
    const piece = byKey.get(key);
    if (!piece || seen.has(key)) return 0;
    const next = new Set(seen).add(key);
    const deps = piece.dependsOn.map((dep) => chain(dep, next));
    const value = piece.sizeEstimate + Math.max(0, ...deps);
    longest.set(key, value);
    return value;
  };
  const critical = Math.max(...pieces.map((piece) => chain(piece.key, new Set())));
  return 1 - critical / total;
}

function blockerOf(piece: PlaceablePiece): string | null {
  for (const path of [...piece.owned.paths, ...piece.owned.globs]) {
    const kind = sharedTreeBlocker(path);
    if (kind) return `${piece.key} owns ${path}, ${kind}`;
  }
  return null;
}

function isolationReason(
  pieces: readonly PlaceablePiece[],
  facts: PlacementFacts,
): { reason: string; blockerOnly: boolean } | null {
  if (facts.stableCheckout)
    return { reason: 'the project keeps its checkout stable', blockerOnly: false };
  if (facts.repoBusy) return { reason: 'another task is working in this repo', blockerOnly: false };
  if (facts.skipsGate) {
    return { reason: "the agent's mode skips the approval gate", blockerOnly: false };
  }
  if (facts.destructive || pieces.some((piece) => piece.destructive)) {
    return { reason: 'the story deletes, migrates or rewrites data', blockerOnly: false };
  }
  const long = pieces.find((piece) => isLong(piece, facts));
  if (long) return { reason: `${long.key} is a long piece`, blockerOnly: false };
  const blocker = pieces.map(blockerOf).find((reason) => reason !== null);
  return blocker ? { reason: blocker, blockerOnly: true } : null;
}

function inOrder(reason: string, saving: number, unsure: boolean): Omit<Placement, 'pieces'> {
  return { placement: 'in_order', row: 1, reason, saving, splitUnsure: unsure };
}

function ladder(
  pieces: readonly PlaceablePiece[],
  facts: PlacementFacts,
): Omit<Placement, 'pieces'> {
  const building = pieces.filter((piece) => !piece.research);
  const saving = criticalPathSaving(building);
  const unsure =
    saving >= COORD_CRITICAL_PATH_SAVING && saving < COORD_CRITICAL_PATH_SAVING + UNSURE_MARGIN;
  if (!facts.git) return inOrder('the project is not a git repository', saving, false);
  if (!independentLargePair(building)) {
    return inOrder('fewer than 2 independent large pieces', saving, false);
  }
  if (saving < COORD_CRITICAL_PATH_SAVING) {
    return inOrder(`critical-path saving ${Math.round(saving * 100)}% is below 35%`, saving, false);
  }
  if (unsure && facts.splitWorthIt !== null && facts.splitWorthIt <= COORD_SPLIT_UNSURE_AT) {
    return inOrder('Jev expects no gain from working at the same time', saving, true);
  }
  const isolation = isolationReason(building, facts);
  const jevAllowsShared = facts.sameFolder !== null && facts.sameFolder >= COORD_JEV_ACT_AT;
  if (isolation && !(isolation.blockerOnly && jevAllowsShared)) {
    return { placement: 'worktree', row: 2, reason: isolation.reason, saving, splitUnsure: unsure };
  }
  const reason = isolation
    ? `${isolation.reason}, but Jev expects no conflict in one folder`
    : 'independent pieces with separate files';
  return { placement: 'shared', row: 3, reason, saving, splitUnsure: unsure };
}

export function placePieces(pieces: readonly PlaceablePiece[], facts: PlacementFacts): Placement {
  const chosen = ladder(pieces, facts);
  return {
    ...chosen,
    pieces: pieces.map((piece) => ({
      key: piece.key,
      placement: piece.research ? 'read_only' : chosen.placement,
    })),
  };
}
