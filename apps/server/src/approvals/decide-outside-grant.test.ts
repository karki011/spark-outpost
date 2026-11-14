import { describe, expect, it } from 'vitest';
import type { ModePosture } from '@spark-outpost/contracts';
import { NO_RUN_RULES, decide, type ApprovalRequest, type DecideOptions } from './decide.ts';
import { parseShell } from './shell-parse.ts';

const ROOT = '/work/app';
const HOME = '/Users/me';
const NO_FILES = { glob: () => [], walk: () => [], script: () => null };

function request(overrides: Partial<ApprovalRequest>): ApprovalRequest {
  return {
    toolCallId: 't1',
    rpcId: null,
    kind: 'execute',
    toolKind: 'execute',
    title: 'run',
    command: null,
    cwd: ROOT,
    paths: [],
    diffs: [],
    options: [],
    roots: [{ path: ROOT, ignore: [] }],
    home: HOME,
    ...overrides,
  };
}

const edit = (target: string) =>
  request({ kind: 'edit', toolKind: 'edit', title: `Edit ${target}`, paths: [target] });

async function decided(posture: ModePosture, asked: ApprovalRequest, granted: boolean) {
  const shell = asked.command ? await parseShell(asked.command) : null;
  const options: DecideOptions = { files: NO_FILES, shell, browserData: null };
  return decide(posture, asked, NO_RUN_RULES, [], { ...options, outsideWriteGrant: granted });
}

describe('writes outside the project with no Spark rules', () => {
  it('ask in every mode the gate sees, marked as an outside write', async () => {
    for (const posture of ['asks', 'edits', 'auto', 'full_access'] as const) {
      expect(await decided(posture, edit(`${HOME}/notes.md`), false)).toEqual({
        verdict: 'ask',
        reason: 'This changes ~/notes.md, which is outside this project',
        outsideWrite: true,
      });
    }
  });

  it('follow the mode once the session is allowed, like a write in the project', async () => {
    const outside = edit(`${HOME}/notes.md`);
    expect((await decided('edits', outside, true)).verdict).toBe('allow');
    expect((await decided('auto', outside, true)).verdict).toBe('allow');
    expect(await decided('asks', outside, true)).toEqual(
      await decided('asks', edit(`${ROOT}/a.ts`), false),
    );
    expect(
      (await decided('full_access', request({ command: 'echo x > ~/out.txt' }), true)).verdict,
    ).toBe('allow');
  });

  it('still ask before a delete outside the project, even in an allowed session', async () => {
    const decision = await decided('full_access', request({ command: 'rm ~/old.txt' }), true);
    expect(decision).toEqual({
      verdict: 'ask',
      reason: 'This deletes ~/old.txt, which is outside this project',
    });
  });

  it('still ask before a secret file changes, even in an allowed session', async () => {
    const decision = await decided('full_access', edit(`${ROOT}/.env`), true);
    expect(decision.verdict).toBe('ask');
  });
});
