import type { ListPlacement, PiecePlacement } from '@spark-outpost/contracts';

const MANIFEST =
  /(?:^|\/)(?:package\.json|pnpm-workspace\.yaml|Cargo\.toml|go\.mod|pyproject\.toml|setup\.(?:py|cfg)|requirements[^/]*\.txt|Pipfile|Gemfile|composer\.json|deno\.jsonc?)$/i;
const LOCKFILE =
  /(?:^|\/)(?:[^/]+\.lock|[^/]+-lock\.(?:json|ya?ml)|bun\.lockb|go\.sum|npm-shrinkwrap\.json)$/i;
const GENERATED =
  /(?:^|\/)(?:dist|build|out|generated|__generated__|coverage|\.next)\/|\.(?:gen|generated)\.[^/]+$|\.d\.ts$|\.min\.(?:js|css)$/i;
const MIGRATIONS = /(?:^|\/)(?:migrations?|migrate|db\/migrate)\//i;

export const NOT_GIT_REASON = 'the project is not a git repository';
export const OWN_COPIES_REASON =
  "the agent's mode runs without the approval gate, so each piece works in its own copy";
export const SHARED_TREE_REASON = 'the approval gate holds each piece to its own files';

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
  research: boolean;
}

export interface PlacementFacts {
  git: boolean;
  skipsGate: boolean;
}

export interface Placement {
  placement: ListPlacement;
  reason: string;
  pieces: { key: string; placement: PiecePlacement }[];
}

function listPlace(facts: PlacementFacts): Pick<Placement, 'placement' | 'reason'> {
  if (!facts.git) return { placement: 'in_order', reason: NOT_GIT_REASON };
  if (facts.skipsGate) return { placement: 'worktree', reason: OWN_COPIES_REASON };
  return { placement: 'shared', reason: SHARED_TREE_REASON };
}

export function placePieces(pieces: readonly PlaceablePiece[], facts: PlacementFacts): Placement {
  const chosen = listPlace(facts);
  return {
    ...chosen,
    pieces: pieces.map((piece) => ({
      key: piece.key,
      placement: piece.research ? 'read_only' : chosen.placement,
    })),
  };
}
