import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { git, write } from './ship-support.ts';

export const PLANTED_TOKEN = 'ghu_plantedCloneToken0123456789abcdefghijkl';

export interface CloneWorld {
  base: string;
  home: string;
  documents: string;
  sourceUrl: string;
  scripts: string;
}

export async function cloneWorld(): Promise<CloneWorld> {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-clone-')));
  const home = path.join(base, 'home');
  const documents = path.join(home, 'Documents');
  const scripts = path.join(base, 'scripts');
  await mkdir(documents, { recursive: true });
  await mkdir(scripts);
  const work = path.join(base, 'work');
  const bare = path.join(base, 'sources', 'widgets.git');
  execFileSync('git', ['init', '-q', '-b', 'main', work]);
  git(work, 'config', 'user.name', 'Test Person');
  git(work, 'config', 'user.email', 'test@example.test');
  git(work, 'config', 'commit.gpgsign', 'false');
  await write(work, 'README.md', '# Widgets\n');
  await write(work, 'src/index.ts', 'export const widgets = 1;\n');
  git(work, 'add', '.');
  git(work, 'commit', '-qm', 'start');
  execFileSync('git', ['clone', '-q', '--bare', work, bare]);
  return { base, home, documents, sourceUrl: `file://${bare}`, scripts };
}

async function script(world: CloneWorld, name: string, body: string): Promise<string> {
  const file = path.join(world.scripts, name);
  await writeFile(file, `#!/bin/sh\n${body}`);
  await chmod(file, 0o755);
  return file;
}

export function stallingGit(world: CloneWorld): Promise<string> {
  return script(
    world,
    'stalling-git',
    `for last; do :; done
mkdir -p "$last/.git"
echo partial > "$last/.git/partial"
echo "Receiving objects:  42% (42/100)" >&2
trap 'exit 143' TERM
sleep 60 &
wait $!
`,
  );
}

export function refusingGit(world: CloneWorld, message: string): Promise<string> {
  return script(
    world,
    'refusing-git',
    `for last; do :; done
mkdir -p "$last/.git"
echo partial > "$last/.git/partial"
cat >&2 <<'MESSAGE'
${message}
MESSAGE
exit 128
`,
  );
}

export interface TokenRecord {
  argv: string;
  askpassScript: string;
  askpassPath: string;
  askpassAnswer: string;
}

export async function tokenOnlyGit(world: CloneWorld): Promise<string> {
  const record = path.join(world.base, 'record');
  await mkdir(record);
  return script(
    world,
    'token-only-git',
    `if [ -z "$SPARK_GIT_TOKEN" ]; then
  echo "fatal: could not read Username for 'https://github.com': terminal prompts disabled" >&2
  exit 128
fi
printf '%s\\n' "$@" > "${record}/argv"
cat "$GIT_ASKPASS" > "${record}/askpassScript"
printf '%s' "$GIT_ASKPASS" > "${record}/askpassPath"
"$GIT_ASKPASS" 'Password for https://github.com:' > "${record}/askpassAnswer"
exec git "$@"
`,
  );
}

export async function tokenRecord(world: CloneWorld): Promise<TokenRecord> {
  const read = (name: string) => readFile(path.join(world.base, 'record', name), 'utf8');
  return {
    argv: await read('argv'),
    askpassScript: await read('askpassScript'),
    askpassPath: await read('askpassPath'),
    askpassAnswer: await read('askpassAnswer'),
  };
}

export async function treeText(root: string): Promise<string> {
  const parts: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true, recursive: true })) {
    const full = path.join(entry.parentPath, entry.name);
    parts.push(full);
    if (entry.isFile()) parts.push((await readFile(full)).toString('latin1'));
  }
  return parts.join('\n');
}
