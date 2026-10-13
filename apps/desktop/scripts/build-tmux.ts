import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { MacArch } from './builder-config.ts';
import {
  checkTmuxBinary,
  checkTmuxStarts,
  clangArch,
  DEPLOYMENT_TARGET,
  hostTriple,
  LIBEVENT,
  TMUX,
  tmuxBuiltDir,
  tmuxCacheDir,
  tmuxStamp,
  type TmuxSource,
} from './tmux-bundle.ts';

const run = promisify(execFile);
const BUFFER = 256 * 1024 * 1024;

async function tarball(cache: string, source: TmuxSource): Promise<string> {
  const file = path.join(cache, 'src', source.file);
  let data = await readFile(file).catch(() => null);
  if (!data) {
    console.log(`Downloading ${source.url}`);
    const response = await fetch(source.url);
    if (!response.ok) throw new Error(`Could not download ${source.url} (${response.status}).`);
    data = Buffer.from(await response.arrayBuffer());
  }
  const sha256 = createHash('sha256').update(data).digest('hex');
  if (sha256 !== source.sha256)
    throw new Error(`${source.file} has sha256 ${sha256}; the pinned one is ${source.sha256}.`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, data);
  return file;
}

async function unpack(file: string, into: string, source: TmuxSource): Promise<string> {
  await mkdir(into, { recursive: true });
  await run('tar', ['-xzf', file, '-C', into]);
  return path.join(into, source.folder);
}

async function make(cwd: string, configure: string[], env: NodeJS.ProcessEnv): Promise<void> {
  const options = { cwd, env, maxBuffer: BUFFER };
  await run('./configure', configure, options);
  await run('make', [`-j${os.availableParallelism()}`], options);
  await run('make', ['install'], options);
}

async function isCurrent(built: string, arch: MacArch): Promise<boolean> {
  const stamp = await readFile(path.join(built, 'stamp'), 'utf8').catch(() => null);
  if (stamp !== tmuxStamp()) return false;
  return checkTmuxBinary(path.join(built, 'bin/tmux'), arch).then(
    () => true,
    () => false,
  );
}

export async function buildTmux(repoRoot: string, arch: MacArch): Promise<string> {
  const cache = tmuxCacheDir(repoRoot);
  const built = tmuxBuiltDir(repoRoot, arch);
  const binary = path.join(built, 'bin/tmux');
  if (!(await isCurrent(built, arch))) {
    console.log(`Building tmux ${TMUX.version} for ${arch}.`);
    const work = path.join(cache, 'build', arch);
    const dep = path.join(work, 'dep');
    await rm(work, { recursive: true, force: true });
    await rm(built, { recursive: true, force: true });
    const flags = `-arch ${clangArch(arch)} -mmacosx-version-min=${DEPLOYMENT_TARGET} -O2`;
    const env = {
      ...process.env,
      CC: 'clang',
      CFLAGS: flags,
      LDFLAGS: flags,
      MACOSX_DEPLOYMENT_TARGET: DEPLOYMENT_TARGET,
      PKG_CONFIG_PATH: path.join(dep, 'lib/pkgconfig'),
      PKG_CONFIG_LIBDIR: path.join(dep, 'lib/pkgconfig'),
    };
    const host = `--host=${hostTriple(arch)}`;
    const libevent = await unpack(await tarball(cache, LIBEVENT), work, LIBEVENT);
    await make(
      libevent,
      [
        `--prefix=${dep}`,
        host,
        '--disable-shared',
        '--enable-static',
        '--disable-openssl',
        '--disable-samples',
        '--disable-libevent-regress',
        '--disable-debug-mode',
      ],
      env,
    );
    const tmux = await unpack(await tarball(cache, TMUX), work, TMUX);
    await make(tmux, [`--prefix=${built}`, host, '--disable-utf8proc', '--disable-jemalloc'], {
      ...env,
      LIBEVENT_CORE_CFLAGS: `-I${path.join(dep, 'include')}`,
      LIBEVENT_CORE_LIBS: `${path.join(dep, 'lib/libevent_core.a')}`,
    });
    await mkdir(path.join(built, 'licenses'), { recursive: true });
    await cp(path.join(tmux, TMUX.licence), path.join(built, 'licenses/tmux-COPYING.txt'));
    await cp(
      path.join(libevent, LIBEVENT.licence),
      path.join(built, 'licenses/libevent-LICENSE.txt'),
    );
    await rm(path.join(built, 'share'), { recursive: true, force: true });
    await writeFile(path.join(built, 'stamp'), tmuxStamp());
    await rm(work, { recursive: true, force: true });
  }
  await checkTmuxBinary(binary, arch);
  if (arch === os.arch()) await checkTmuxStarts(binary);
  return built;
}
