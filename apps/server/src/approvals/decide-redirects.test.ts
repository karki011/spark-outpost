import { describe, expect, it } from 'vitest';
import type { ModePosture } from '@spark-outpost/contracts';
import {
  NO_RUN_RULES,
  OUTSIDE_WRITE_REASON,
  SECRET_REASON,
  decide,
  type ApprovalRequest,
} from './decide.ts';
import type { FileLister } from './file-lister.ts';
import { parseShell } from './shell-parse.ts';

const ROOT = '/work/app';
const noFiles: FileLister = { glob: () => [], walk: () => [], script: () => null };

function run(command: string): ApprovalRequest {
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
  };
}

const parsed = async (posture: ModePosture, command: string) =>
  decide(posture, run(command), NO_RUN_RULES, [], {
    files: noFiles,
    shell: await parseShell(command),
  });

const ROUTINE = [
  'for f in $(ls src); do echo "$f $(wc -l < src/$f)"; done',
  'for f in $(ls src); do echo $f $(wc -l < src/$f); done',
  "cat > NOTES.md <<'NOTE'\n# Notes\nLine counts checked.\nNOTE",
  'cat <<EOF > out/report.txt\nhello $USER\nEOF',
  'pnpm install --offline 2>&1 | tail -3',
  'node --test "test/**/*.test.ts" 2>&1 | tail -6',
  'pnpm build > /dev/null',
  'pnpm build >> build.log 2>&1',
  'for f in src/*.ts; do wc -l "$f" > "out/$f.count"; done',
  'while read -r line; do echo "$line"; done < "lists/$NAME.txt"',
  'echo done > "$OUT"',
  'sort < "$TMPFILE" > sorted.txt',
];

describe('decide() reads redirects with variable paths by their literal part', () => {
  it.each(ROUTINE)('lets Auto run a routine command: %s', async (command) => {
    expect(await parsed('auto', command)).toEqual({ verdict: 'allow', by: 'level' });
  });

  it.each(ROUTINE)('lets Bypass permissions run a routine command: %s', async (command) => {
    expect(await parsed('full_access', command)).toEqual({ verdict: 'allow', by: 'level' });
  });

  it.each([
    'cat < .env',
    'cat < .env.$STAGE',
    'cat < config/.env.$STAGE',
    'cat < ~/.ssh/$KEY',
    'cat < $HOME/.ssh/id_rsa',
    'wc -l < $DIR/server.pem',
    'echo x > .env.$STAGE',
  ])('still asks when the literal part names a secret: %s', async (command) => {
    expect(await parsed('full_access', command)).toEqual({ verdict: 'ask', reason: SECRET_REASON });
  });

  it.each([
    'echo x > ../$f',
    'echo x > /etc/$f',
    'echo x >> ~/notes/$DAY.md',
    'echo x > ../../out',
  ])('still asks when the literal part leaves the project: %s', async (command) => {
    expect(await parsed('full_access', command)).toEqual({
      verdict: 'ask',
      reason: OUTSIDE_WRITE_REASON,
    });
  });

  it('does not count a variable read as a proven read-only command', async () => {
    const command = 'for f in $(ls src); do echo "$f $(wc -l < src/$f)"; done';
    expect(await parsed('asks', command)).toEqual({ verdict: 'ask', reason: null });
  });

  it('keeps plain reads inside the project proven read-only', async () => {
    expect(await parsed('asks', 'wc -l < src/index.ts')).toMatchObject({ verdict: 'allow' });
  });
});
