import { describe, expect, it } from 'vitest';
import type { ModePosture } from '@spark-outpost/contracts';
import { TEST_RUNNER_ALLOWLIST } from './command-kinds.ts';
import { NO_RUN_RULES, decide, type ApprovalRequest, type DecideOptions } from './decide.ts';
import {
  SHARED_INSTALL_REASON,
  WHOLE_TREE_REWRITE_REASON,
  type PieceGuard,
} from './piece-guard.ts';
import { PIECE_CHECKED_WHY, pieceUnclearReason } from './piece-route.ts';
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
  'b piece in its own copy': { builder: true, piece: { coordinated: true, owned: OWNED } },
  'c piece sharing the tree': {
    builder: true,
    piece: { coordinated: true, owned: OWNED, sharesTree: true },
    routedPiece: true,
  },
  'd single piece': { builder: true, piece: { coordinated: true, owned: ALONE } },
};
const SHARED = SITUATIONS['c piece sharing the tree']!;

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

function expected(situation: string, posture: ModePosture, noted: boolean): string {
  if (posture === 'full_access') return 'allow (level)';
  if (posture === 'auto' && !noted) return 'allow (level)';
  if (posture === 'auto' && situation.startsWith('c ')) return `allow (${PIECE_CHECKED_WHY})`;
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
        ]).toEqual([command, expected(situation, posture, noted)]);
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
  it.each(['auto', 'full_access'] as const)(
    'runs a command Spark can read without a card in %s, even with Claude’s note',
    async (posture) => {
      expect(
        await verdict(posture, 'npx vitest run src/api.test.ts > /tmp/out.log', SHARED, true),
      ).toMatch(/^allow/);
      expect(await verdict(posture, 'echo x >> src/api.ts', SHARED, true)).toMatch(/^allow/);
    },
  );

  it('asks, and says why, only when Claude noted the command and Spark cannot tell what it changes', async () => {
    const unclear = `ask (${pieceUnclearReason(OWNED)})`;
    expect(unclear).toBe(
      "ask (Bolt shares this folder with 2 other pieces, and Spark couldn't tell what this command changes)",
    );
    expect(await verdict('auto', 'npx vitest run src/api.test.ts > "$OUT"', SHARED, true)).toBe(
      unclear,
    );
    expect(await verdict('auto', 'f() { npx vitest; }; f', SHARED, true)).toBe(unclear);
    expect(await verdict('auto', 'npx vitest run src/api.test.ts > "$OUT"', SHARED)).toBe(
      'allow (level)',
    );
    expect(await verdict('full_access', 'f() { npx vitest; }; f', SHARED, true)).toBe(
      'allow (level)',
    );
  });

  it('leaves the agent’s own ask alone outside a shared folder', async () => {
    const own = SITUATIONS['b piece in its own copy']!;
    expect(await verdict('auto', 'npx vitest run src/api.test.ts', own, true)).toBe(
      'ask (the mode asks)',
    );
    const codex = { ...SHARED, routedPiece: false };
    expect(await verdict('auto', 'npx vitest run src/api.test.ts', codex, true)).toBe(
      'ask (the mode asks)',
    );
  });

  it.each(POSTURES)('refuses, without a card, what breaks a piece rule in %s', async (posture) => {
    for (const noted of [false, true]) {
      expect(await verdict(posture, 'pnpm add zod', SHARED, noted)).toBe(
        `refuse (${SHARED_INSTALL_REASON})`,
      );
      expect(await verdict(posture, 'pnpm check', SHARED, noted)).toBe(
        'refuse (Inside a piece, the coordinator runs the full checks after integration)',
      );
      expect(await verdict(posture, 'echo x > src/view.tsx', SHARED, noted)).toMatch(
        /^refuse \(Tack \(P2\) owns `src\/view.tsx`/,
      );
      expect(await verdict(posture, 'git commit -am wip', SHARED, noted)).toMatch(
        /^refuse \(Builders in a coordinated/,
      );
    }
  });

  it.each(POSTURES)('still asks for the safety floor in %s', async (posture) => {
    expect(await verdict(posture, 'cat .env', SHARED, true)).toBe('ask (Secret files always ask)');
    expect(await verdict(posture, 'echo x > ~/notes.txt', SHARED, true)).toBe(
      'ask (This changes ~/notes.txt, which is outside this project)',
    );
  });
});

describe('decide() for checks that rewrite files inside a piece', () => {
  const piece = SITUATIONS['b piece in its own copy']!;

  it.each([
    ['npx eslint --fix src/view.tsx', /^refuse \(Tack \(P2\) owns `src\/view.tsx`/],
    ['npx prettier --write src/store.ts', /^refuse \(Rivet \(P3\) owns `src\/store.ts`/],
    ['pnpm exec vitest run -u src/view.test.tsx', /^refuse \(No piece owns `src\/view.test.tsx`/],
    ['npx eslint --fix src', /^refuse \(No piece owns `src`/],
  ])('refuses %s', async (command, reason) => {
    expect(await verdict('full_access', command, piece)).toMatch(reason);
  });

  it.each(['npx eslint --fix .', 'npx prettier --write .', 'npx vitest -u'])(
    'refuses the whole-folder rewrite %s',
    async (command) => {
      expect(await verdict('auto', command, piece)).toBe(`refuse (${WHOLE_TREE_REWRITE_REASON})`);
    },
  );

  it.each([
    'npx eslint --fix src/api.ts',
    'npx prettier --write src/api.ts src/api.test.ts',
    'npx vitest run -u src/api.test.ts',
    'npx eslint src/view.tsx',
    'npx prettier --check .',
    'sort -u src/view.tsx',
    'npx vitest run src/api.test.ts --coverage > coverage/summary.txt',
    'npx eslint src/api.ts --cache --cache-location node_modules/.cache/eslint > node_modules/.cache/lint.log',
  ])('lets %s follow the mode', async (command) => {
    expect(await verdict('auto', command, piece)).toBe('allow (level)');
  });

  it('refuses a write to a cache-like path another piece owns', async () => {
    const owner = {
      ...OWNED,
      others: [{ key: 'P2', name: 'Tack', paths: ['coverage/report.ts'], globs: [] }],
    };
    const options = { builder: true, piece: { coordinated: true, owned: owner } };
    expect(await verdict('auto', 'echo x > coverage/report.ts', options)).toMatch(
      /^refuse \(Tack \(P2\) owns/,
    );
  });
});
