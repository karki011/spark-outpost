import type { WorkPlace } from '@spark-outpost/contracts';

export interface PlaceFacts {
  preference: WorkPlace;
  requested: string | null;
  current: string | null;
  clean: boolean;
  local: readonly string[];
  remote: ReadonlyMap<string, string>;
  checkedOutElsewhere: boolean;
}

export type PlaceDecision =
  | { kind: 'checkout'; note: string | null }
  | { kind: 'in_place'; branch: string }
  | { kind: 'new'; from: string | null; note: string | null }
  | { kind: 'existing'; branch: string }
  | { kind: 'remote'; branch: string; ref: string };

function fromBranch(branch: string, why: string): PlaceDecision {
  return {
    kind: 'new',
    from: branch,
    note: `${branch} ${why}, so this chat works on its own branch started from ${branch}.`,
  };
}

function missing(requested: string, preference: WorkPlace): PlaceDecision {
  const note = `There is no branch named ${requested}, so this chat works on its own branch.`;
  if (preference === 'checkout') {
    return { kind: 'checkout', note: `There is no branch named ${requested}.` };
  }
  return { kind: 'new', from: null, note };
}

export function decidePlace(facts: PlaceFacts): PlaceDecision {
  const requested = facts.requested;
  if (requested) {
    if (requested === facts.current) {
      if (facts.clean) return { kind: 'in_place', branch: requested };
      return fromBranch(requested, 'is checked out in your folder with uncommitted changes');
    }
    if (facts.local.includes(requested)) {
      if (facts.checkedOutElsewhere) return fromBranch(requested, 'is open in another worktree');
      return { kind: 'existing', branch: requested };
    }
    const ref = facts.remote.get(requested);
    if (ref) return { kind: 'remote', branch: requested, ref };
    return missing(requested, facts.preference);
  }
  if (facts.preference === 'checkout') return { kind: 'checkout', note: null };
  return { kind: 'new', from: null, note: null };
}

const NAMED_BRANCH = [
  /\bbranch(?:es)?\s+(?:named\s+|called\s+)?[`'"]?([\w./-]+)/gi,
  /[`'"]?([\w./-]+)[`'"]?\s+branch\b/gi,
];

function trimmed(name: string): string {
  return name.replace(/[.,;:!?)]+$/, '');
}

export function namedBranch(text: string, known: ReadonlySet<string>): string | null {
  for (const pattern of NAMED_BRANCH) {
    for (const match of text.matchAll(pattern)) {
      const name = trimmed(match[1] ?? '');
      if (name && known.has(name)) return name;
    }
  }
  return null;
}
