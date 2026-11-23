import { describe, expect, it } from 'vitest';
import { MODE_POSTURES, type ModePosture } from '@spark-outpost/contracts';
import { NO_RUN_RULES, POWERSHELL_REASON, decide, type ApprovalRequest } from './decide.ts';
import type { FileLister } from './file-lister.ts';
import { parseShell } from './shell-parse.ts';

const ROOT = '/c/work/app';
const noFiles: FileLister = { glob: () => [], walk: () => [], script: () => null };

function request(extra: Partial<ApprovalRequest>): ApprovalRequest {
  return {
    toolCallId: 't1',
    rpcId: null,
    kind: 'execute',
    toolKind: 'execute',
    title: 'Run it',
    command: null,
    cwd: ROOT,
    paths: [],
    diffs: [],
    options: [],
    roots: [{ path: ROOT, ignore: [] }],
    home: '/c/Users/me',
    ...extra,
  };
}

async function decideCommand(posture: ModePosture, command: string, powershell: boolean) {
  return decide(posture, request({ command, title: command }), NO_RUN_RULES, ['Get-Content'], {
    files: noFiles,
    shell: await parseShell(command),
    powershell,
  });
}

const ASKS = { verdict: 'ask', reason: POWERSHELL_REASON };
const COMMANDS = ['Get-Content C:\\Users\\me\\.ssh\\id_rsa', 'ls', 'Remove-Item -Recurse C:\\'];

describe('Codex commands on Windows', () => {
  const asking = MODE_POSTURES.filter((posture) => posture !== 'denies');

  it.each(asking)('asks before every command in %s', async (posture) => {
    for (const command of COMMANDS) {
      expect(await decideCommand(posture, command, true)).toEqual(ASKS);
    }
  });

  it('keeps a mode that skips anything not pre-approved skipping it', async () => {
    expect((await decideCommand('denies', 'ls', true)).verdict).toBe('reject');
  });

  it('decides an edit as before', () => {
    const edit = request({ kind: 'edit', toolKind: 'edit', paths: [`${ROOT}/a.ts`] });
    const options = { files: noFiles, powershell: true };
    const without = { files: noFiles };
    expect(decide('auto', edit, NO_RUN_RULES, [], options)).toEqual(
      decide('auto', edit, NO_RUN_RULES, [], without),
    );
  });

  it('reads commands as before elsewhere', async () => {
    expect(await decideCommand('auto', 'ls', false)).not.toEqual(ASKS);
  });
});
