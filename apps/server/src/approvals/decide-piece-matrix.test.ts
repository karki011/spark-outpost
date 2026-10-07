import { describe, expect, it } from 'vitest';
import type { ModePosture } from '@spark-outpost/contracts';
import { TEST_RUNNER_ALLOWLIST } from './command-kinds.ts';
import {
  NO_RUN_RULES,
  SECRET_REASON,
  decide,
  type ApprovalRequest,
  type DecideOptions,
} from './decide.ts';
import type { PieceGuard } from './piece-guard.ts';
import { parseShell } from './shell-parse.ts';

const ROOT = '/work/app';
const OWNED: NonNullable<PieceGuard['owned']> = {
  key: 'P1',
  name: 'Bolt',
  paths: ['src/api.ts', 'src/api.test.ts'],
  globs: [],
  others: [
    { key: 'P2', name: 'Tack', paths: ['src/view.tsx'], globs: [] },
    { key: 'P3', name: 'Rivet', paths: ['src/store.ts'], globs: [] },
  ],
};
const ALONE = { ...OWNED, others: [] };
const NO_FILES = { glob: () => [], walk: () => [], script: () => null };

const SITUATIONS: Record<string, DecideOptions> = {
  'a solo chat turn': {},
  'b piece sharing the tree': { builder: true, piece: { coordinated: true, owned: OWNED } },
  'c single piece': { builder: true, piece: { coordinated: true, owned: ALONE } },
};
const SHARED = SITUATIONS['b piece sharing the tree']!;

const CHECKS = [
  'npx vitest run src/api.test.ts',
  'npx vitest',
  'pnpm vitest',
  'npx tsc --noEmit',
  'npx eslint src/api.ts',
  'npx nx test api',
  'pnpm nx run api:test',
  'cd packages/api && npx vitest run src/api.test.ts 2>&1 | tail -20',
];
const LISTED_CHECK = 'pnpm test -- src/api.test.ts';
const POSTURES: ModePosture[] = ['asks', 'edits', 'auto', 'full_access'];
const LEVELS = ['hands-off', 'full-auto'] as const;
const CLAUDE_NOTE = 'This command requires approval';

function request(command: string, noted: boolean): ApprovalRequest {
  return {
    toolCallId: 't1',
    rpcId: null,
    kind: 'execute',
    toolKind: 'execute',
    title: command,
    command,
    cwd: ROOT,
    paths: [],
    diffs: [],
    options: [],
    roots: [{ path: ROOT, ignore: [] }],
    home: '/Users/me',
    ...(noted ? { agentReason: CLAUDE_NOTE } : {}),
  };
}

async function verdict(
  posture: ModePosture,
  command: string,
  options: DecideOptions,
  noted = false,
  level: (typeof LEVELS)[number] = 'hands-off',
): Promise<string> {
  const decision = decide(posture, request(command, noted), NO_RUN_RULES, TEST_RUNNER_ALLOWLIST, {
    ...options,
    files: NO_FILES,
    shell: await parseShell(command),
    agentAsks: noted,
    publish: { grant: { level, requested: false }, task: null },
  });
  if (decision.verdict === 'allow') return `allow (${decision.why ?? decision.by})`;
  if (decision.verdict === 'reject') return `refuse (${decision.reason})`;
  return `ask (${decision.reason ?? decision.because ?? 'the mode asks'})`;
}

function expected(posture: ModePosture, noted: boolean): string {
  if (posture === 'full_access') return 'allow (level)';
  if (posture === 'auto' && !noted) return 'allow (level)';
  return 'ask (the mode asks)';
}

describe('decide() for a targeted check, by situation, agent mode and Spark autonomy', () => {
  const rows = Object.keys(SITUATIONS).flatMap((situation) =>
    POSTURES.flatMap((posture) =>
      [false, true].map((noted) => [situation, posture, noted] as const),
    ),
  );

  it.each(rows)('%s, %s, with the agent’s own note: %s', async (situation, posture, noted) => {
    for (const level of LEVELS) {
      for (const command of CHECKS) {
        expect([
          command,
          await verdict(posture, command, SITUATIONS[situation]!, noted, level),
        ]).toEqual([command, expected(posture, noted)]);
      }
    }
  });

  it.each(rows)(
    '%s, %s, noted %s: a check on the allowlist never asks',
    async (situation, posture, noted) => {
      const allowed = await verdict(posture, LISTED_CHECK, SITUATIONS[situation]!, noted);
      expect(allowed).toMatch(/^allow/);
    },
  );
});

describe('decide() for a piece that shares its folder', () => {
  it('leaves the agent’s own ask to the mode, as in any other run', async () => {
    expect(await verdict('auto', 'npx vitest run src/api.test.ts', SHARED, true)).toBe(
      'ask (the mode asks)',
    );
    expect(await verdict('full_access', 'f() { npx vitest; }; f', SHARED, true)).toBe(
      'allow (level)',
    );
  });

  it.each(['auto', 'full_access'] as const)(
    'refuses nothing for file ownership or an install in %s',
    async (posture) => {
      for (const command of [
        'pnpm add zod',
        'echo x > src/view.tsx',
        'npx eslint --fix src/view.tsx',
        'npx prettier --write .',
        'pnpm exec vitest run -u src/view.test.tsx',
      ]) {
        expect([command, await verdict(posture, command, SHARED)]).toEqual([
          command,
          'allow (level)',
        ]);
      }
    },
  );

  it('asks for a write to another piece’s file only where the mode asks', async () => {
    expect(await verdict('asks', 'echo x > src/view.tsx', SHARED)).toMatch(/^ask/);
    expect(await verdict('asks', 'echo x > src/api.ts', SHARED)).toMatch(/^ask/);
  });

  it.each(POSTURES)(
    'still refuses whole-project checks and git state changes in %s',
    async (posture) => {
      for (const noted of [false, true]) {
        expect(await verdict(posture, 'pnpm check', SHARED, noted)).toBe(
          'refuse (Inside a piece, the coordinator runs the full checks after integration)',
        );
        expect(await verdict(posture, 'git commit -am wip', SHARED, noted)).toMatch(
          /^refuse \(Builders in a coordinated/,
        );
      }
    },
  );

  it.each(POSTURES)('still asks for the safety floor in %s', async (posture) => {
    expect(await verdict(posture, 'cat ~/.npmrc', SHARED, true)).toBe(`ask (${SECRET_REASON})`);
    expect(await verdict(posture, 'echo x > ~/notes.txt', SHARED, true)).toBe(
      'ask (This changes ~/notes.txt, which is outside this project)',
    );
  });
});
