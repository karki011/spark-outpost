export type StoryArmKey = 'a' | 'a2' | 'b' | 'c' | 'd' | 'direct';

export interface StoryArm {
  key: StoryArmKey;
  label: string;
  kind: 'harness' | 'direct-claude';
  coordinator: 'off' | 'in_order' | 'parallel';
  placement: 'shared' | 'worktree' | null;
  codex: boolean;
  codexRateLimited: boolean;
  fakeTags: string;
  expectUsd: number;
}

const SPLIT_TAGS = ' Split this up. #build #pieces #parallel';

export const STORY_ARMS: Record<StoryArmKey, StoryArm> = {
  a: {
    key: 'a',
    label: 'a · one Builder',
    kind: 'harness',
    coordinator: 'off',
    placement: null,
    codex: true,
    codexRateLimited: false,
    fakeTags: ' #build',
    expectUsd: 2,
  },
  a2: {
    key: 'a2',
    label: 'a2 · pieces in order',
    kind: 'harness',
    coordinator: 'in_order',
    placement: null,
    codex: true,
    codexRateLimited: false,
    fakeTags: SPLIT_TAGS,
    expectUsd: 2.5,
  },
  b: {
    key: 'b',
    label: 'b · shared tree, Claude + Codex',
    kind: 'harness',
    coordinator: 'parallel',
    placement: 'shared',
    codex: true,
    codexRateLimited: false,
    fakeTags: SPLIT_TAGS,
    expectUsd: 3,
  },
  c: {
    key: 'c',
    label: 'c · worktrees, Claude only',
    kind: 'harness',
    coordinator: 'parallel',
    placement: 'worktree',
    codex: false,
    codexRateLimited: false,
    fakeTags: SPLIT_TAGS,
    expectUsd: 3,
  },
  d: {
    key: 'd',
    label: 'd · provider fallback (b, Codex 429 from its 2nd tool call)',
    kind: 'harness',
    coordinator: 'parallel',
    placement: 'shared',
    codex: true,
    codexRateLimited: true,
    fakeTags: `${SPLIT_TAGS} #turn429`,
    expectUsd: 3,
  },
  direct: {
    key: 'direct',
    label: 'direct Claude',
    kind: 'direct-claude',
    coordinator: 'off',
    placement: null,
    codex: false,
    codexRateLimited: false,
    fakeTags: ' #build',
    expectUsd: 1.5,
  },
};

export function parseArms(value: string): StoryArm[] {
  return value.split(',').map((key) => {
    const arm = STORY_ARMS[key.trim() as StoryArmKey];
    if (!arm) throw new Error(`Unknown story arm ${key} (${Object.keys(STORY_ARMS).join(', ')}).`);
    return arm;
  });
}

export function stackEnv(arm: StoryArm): Record<string, string> {
  return {
    COORDINATOR_MODE: arm.coordinator,
    ...(arm.placement ? { COORDINATOR_PLACEMENT: arm.placement } : {}),
  };
}
