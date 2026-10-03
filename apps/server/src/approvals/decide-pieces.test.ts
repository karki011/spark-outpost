import { describe, expect, it } from 'vitest';
import type { ModePosture } from '@spark-outpost/contracts';
import { NO_RUN_RULES, decide, type ApprovalRequest } from './decide.ts';
import { BUILDER_GIT_REASON, SHARED_INSTALL_REASON, type PieceGuard } from './piece-guard.ts';

const ROOT = '/work/app';
const EVERY_MODE: ModePosture[] = ['asks', 'edits', 'auto', 'full_access', 'denies', 'unknown'];

const PIECE: PieceGuard = {
  coordinated: true,
  owned: {
    key: 'P2',
    name: 'Rivet',
    paths: ['src/api.ts'],
    globs: ['src/api/**'],
    others: [{ key: 'P3', name: 'Tack', paths: ['src/view.tsx'], globs: [] }],
  },
};
const INTEGRATOR: PieceGuard = { coordinated: true, owned: null };

function request(overrides: Partial<ApprovalRequest>): ApprovalRequest {
  return {
    toolCallId: 't1',
    rpcId: null,
    kind: 'execute',
    toolKind: 'execute',
    title: 'ls',
    command: 'ls',
    cwd: ROOT,
    paths: [],
    diffs: [],
    options: [],
    roots: [{ path: ROOT, ignore: [] }],
    home: '/Users/me',
    ...overrides,
  };
}

const edit = (relative: string) =>
  request({ kind: 'edit', toolKind: 'edit', command: null, paths: [`${ROOT}/${relative}`] });
const run = (command: string) => request({ command, title: command });

function verdict(posture: ModePosture, req: ApprovalRequest, piece: PieceGuard = PIECE) {
  return decide(posture, req, NO_RUN_RULES, [], { builder: true, piece });
}

describe('decide() for a Builder of a coordinated task', () => {
  it.each(EVERY_MODE)('refuses an edit to another piece’s file in %s', (posture) => {
    expect(verdict(posture, edit('src/view.tsx'))).toEqual({
      verdict: 'reject',
      reason:
        'Tack (P3) owns `src/view.tsx`; this piece (Rivet (P2)) owns `src/api.ts`, `src/api/**`; ask the coordinator in your reply if you need it changed',
    });
  });

  it.each(EVERY_MODE)('refuses an edit to a file no piece owns in %s', (posture) => {
    const decision = verdict(posture, edit('package.json'));
    expect(decision).toMatchObject({ verdict: 'reject' });
    expect(decision.verdict === 'reject' && decision.reason).toMatch(
      /^No piece owns `package.json`/,
    );
  });

  it('leaves edits inside the piece, including globbed files, to the mode', () => {
    expect(verdict('edits', edit('src/api.ts')).verdict).toBe('allow');
    expect(verdict('edits', edit('src/api/routes/tags.ts')).verdict).toBe('allow');
    expect(verdict('asks', edit('src/api.ts')).verdict).toBe('ask');
  });

  it.each([
    ['echo x > src/view.tsx', /^Tack \(P3\) owns `src\/view.tsx`/],
    ['sed -i s/a/b/ package.json', /^No piece owns `package.json`/],
    ['cp src/api.ts src/other.ts', /^No piece owns `src\/other.ts`/],
  ])('refuses the shell write %s outside the piece, even in full access', (command, reason) => {
    const decision = verdict('full_access', run(command));
    expect(decision.verdict).toBe('reject');
    expect(decision.verdict === 'reject' && decision.reason).toMatch(reason);
  });

  it('allows shell writes inside the piece', () => {
    expect(verdict('full_access', run('echo x > src/api/extra.ts')).verdict).toBe('allow');
  });

  it('allows a heredoc write of its own file whose text holds > and =', () => {
    const command = [
      "cat > src/api.ts <<'EOF'",
      'export const ok = (n: number) => n >= 2;',
      'EOF',
      'node --test test/api.test.ts',
    ].join('\n');
    expect(verdict('full_access', run(command)).verdict).toBe('allow');
  });

  it.each([
    'git stash',
    'git checkout main',
    'git reset --hard',
    'git commit -am x',
    'git branch -D old',
    'git worktree add x',
  ])('refuses %s for piece Builders and the integrator', (command) => {
    expect(verdict('full_access', run(command))).toEqual({
      verdict: 'reject',
      reason: BUILDER_GIT_REASON,
    });
    expect(verdict('full_access', run(command), INTEGRATOR).verdict).toBe('reject');
  });

  it('keeps read-only git and does not refuse git state changes outside coordination', () => {
    expect(verdict('asks', run('git status')).verdict).toBe('allow');
    expect(verdict('asks', run('git diff HEAD')).verdict).toBe('allow');
    const plain = decide('full_access', run('git stash'), NO_RUN_RULES, [], { builder: true });
    expect(plain.verdict).toBe('allow');
  });

  it('refuses whole-project checks inside a piece', () => {
    expect(verdict('full_access', run('pnpm check'))).toMatchObject({
      verdict: 'reject',
      reason: 'Inside a piece, the coordinator runs the full checks after integration',
    });
  });

  it.each([
    'pnpm install --offline 2>&1 | tail -3',
    'npm install',
    'pnpm add zod',
    'pip install -r requirements.txt',
  ])('lets a piece run an install in its own tree: %s', (command) => {
    expect(verdict('full_access', run(command))).toEqual({ verdict: 'allow', by: 'level' });
    expect(verdict('asks', run(command))).toEqual({ verdict: 'ask', reason: null });
  });

  it('holds installs, with the reason, while other pieces share the folder', () => {
    const shared: PieceGuard = { ...PIECE, sharesTree: true };
    for (const posture of EVERY_MODE) {
      expect(verdict(posture, run('pnpm add zod'), shared)).toEqual({
        verdict: 'reject',
        reason: SHARED_INSTALL_REASON,
      });
    }
  });

  it('lets the integrator change any file', () => {
    expect(verdict('edits', edit('package.json'), INTEGRATOR).verdict).toBe('allow');
  });
});
