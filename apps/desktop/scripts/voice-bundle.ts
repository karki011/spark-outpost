import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { VOICE_HELPER_NAME, VOICE_SILERO, type VoiceModelFile } from '@spark-outpost/contracts';
import type { MacArch } from './builder-config.ts';
import { checkBundledBinary, clangArch, DEPLOYMENT_TARGET } from './bundled-binary.ts';
import { macControlStamp, swiftEnv } from './mac-control-bundle.ts';

const run = promisify(execFile);
const BUFFER = 256 * 1024 * 1024;

export const TRANSCRIBE_CPP = {
  version: '0.4.1',
  url: 'https://github.com/handy-computer/transcribe.cpp/archive/refs/tags/v0.4.1.tar.gz',
  sha256: '96a3993c075770bf3ca7aeaa86cc55c3673c24d7176643b60cc6a1f46dcab4a5',
  folder: 'transcribe.cpp-0.4.1',
};

export const voicePackage = (repoRoot: string) => path.join(repoRoot, 'apps/desktop/voice');
export const voiceBuiltDir = (repoRoot: string, arch: MacArch) =>
  path.join(repoRoot, '.local/voice', arch);
const voiceCache = (repoRoot: string) => path.join(repoRoot, '.local/voice/cache');

export function transcribeCmakeArgs(arch: MacArch, source: string, build: string, prefix: string) {
  const metal = arch === 'arm64' ? 'ON' : 'OFF';
  return [
    '-S',
    source,
    '-B',
    build,
    '-DCMAKE_BUILD_TYPE=Release',
    '-DTRANSCRIBE_BUILD_SHARED=OFF',
    '-DTRANSCRIBE_BUILD_TESTS=OFF',
    '-DTRANSCRIBE_BUILD_EXAMPLES=OFF',
    '-DTRANSCRIBE_BUILD_TOOLS=OFF',
    '-DTRANSCRIBE_USE_OPENMP=OFF',
    '-DTRANSCRIBE_INSTALL=ON',
    `-DTRANSCRIBE_METAL=${metal}`,
    `-DGGML_METAL_EMBED_LIBRARY=${metal}`,
    '-DGGML_NATIVE=OFF',
    '-DGGML_CCACHE=OFF',
    ...(arch === 'x64'
      ? ['-DGGML_AVX=ON', '-DGGML_AVX2=ON', '-DGGML_FMA=ON', '-DGGML_F16C=ON']
      : []),
    `-DCMAKE_OSX_ARCHITECTURES=${clangArch(arch)}`,
    `-DCMAKE_OSX_DEPLOYMENT_TARGET=${DEPLOYMENT_TARGET}`,
    '-DCMAKE_IGNORE_PREFIX_PATH=/opt/homebrew;/usr/local',
    `-DCMAKE_INSTALL_PREFIX=${prefix}`,
  ];
}

const transcribeLibraries = (arch: MacArch) => [
  'transcribe',
  'ggml',
  'ggml-cpu',
  ...(arch === 'arm64' ? ['ggml-metal'] : []),
  'ggml-base',
];

export function swiftLinkArgs(arch: MacArch, prefix: string): string[] {
  const flags = [`-L${prefix}/lib`, '-framework', 'Accelerate', '-framework', 'Foundation'];
  if (arch === 'arm64') flags.push('-lggml-metal', '-framework', 'Metal', '-framework', 'MetalKit');
  return [`-Xcc`, `-I${prefix}/include`, ...flags.flatMap((flag) => ['-Xlinker', flag])];
}

async function download(url: string, sha256: string, file: string): Promise<string> {
  let data = await readFile(file).catch(() => null);
  if (!data || createHash('sha256').update(data).digest('hex') !== sha256) {
    console.log(`Downloading ${url}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not download ${url} (${response.status}).`);
    data = Buffer.from(await response.arrayBuffer());
  }
  const got = createHash('sha256').update(data).digest('hex');
  if (got !== sha256) throw new Error(`${url} has sha256 ${got}; the pinned one is ${sha256}.`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, data);
  return file;
}

export const downloadModel = (repoRoot: string, model: VoiceModelFile) =>
  download(model.url, model.sha256, path.join(voiceCache(repoRoot), 'models', model.file));

function cmake(): string {
  return process.env.CMAKE ?? 'cmake';
}

function transcribeStamp(arch: MacArch): string {
  const flags = transcribeCmakeArgs(arch, '', '', '').join(' ');
  return `${TRANSCRIBE_CPP.sha256}:${createHash('sha256').update(flags).digest('hex')}`;
}

export function linkManifestProblem(manifest: string, arch: MacArch): string | null {
  const libraries = (JSON.parse(manifest) as { libraries?: unknown }).libraries;
  const expected = transcribeLibraries(arch);
  const same =
    Array.isArray(libraries) &&
    libraries.length === expected.length &&
    expected.every((name) => libraries.includes(name));
  return same
    ? null
    : `transcribe.cpp wants ${JSON.stringify(libraries)} linked, the voice helper links ${JSON.stringify(expected)}`;
}

async function buildTranscribe(repoRoot: string, arch: MacArch): Promise<string> {
  const cache = voiceCache(repoRoot);
  const prefix = path.join(cache, 'transcribe', arch);
  const stamp = path.join(prefix, 'stamp');
  if ((await readFile(stamp, 'utf8').catch(() => null)) === transcribeStamp(arch)) return prefix;
  const tarball = await download(
    TRANSCRIBE_CPP.url,
    TRANSCRIBE_CPP.sha256,
    path.join(cache, 'src', `transcribe.cpp-${TRANSCRIBE_CPP.version}.tar.gz`),
  );
  const work = path.join(cache, 'work', arch);
  await rm(work, { recursive: true, force: true });
  await rm(prefix, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  await run('tar', ['-xzf', tarball, '-C', work]);
  const source = path.join(work, TRANSCRIBE_CPP.folder);
  const build = path.join(work, 'build');
  console.log(`Building transcribe.cpp ${TRANSCRIBE_CPP.version} for ${arch}.`);
  const options = { maxBuffer: BUFFER, env: swiftEnv(process.env) };
  try {
    await run(cmake(), transcribeCmakeArgs(arch, source, build, prefix), options);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      throw new Error(
        'cmake is missing: install it (brew install cmake) or set CMAKE to its path.',
        { cause: error },
      );
    throw error;
  }
  await run(cmake(), ['--build', build, '-j', String(os.availableParallelism())], options);
  await run(cmake(), ['--install', build], options);
  const problem = linkManifestProblem(
    await readFile(path.join(prefix, 'lib', 'transcribe-link.json'), 'utf8'),
    arch,
  );
  if (problem) throw new Error(`${problem}.`);
  await cp(path.join(source, 'LICENSE'), path.join(prefix, 'LICENSE'));
  await cp(
    path.join(source, 'THIRD-PARTY-LICENSES.md'),
    path.join(prefix, 'THIRD-PARTY-LICENSES.md'),
  );
  await writeFile(stamp, transcribeStamp(arch));
  return prefix;
}

export function voiceCheck(binary: string, arch: MacArch) {
  return checkBundledBinary({
    name: VOICE_HELPER_NAME,
    path: binary,
    arch,
    missing: 'Run pnpm desktop:voice to build it; Voice needs it.',
  });
}

export async function checkVoiceAnswers(binary: string): Promise<void> {
  const child = execFile(binary, [], { env: {}, timeout: 10_000 });
  const answered = new Promise<string>((resolve, reject) => {
    let output = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
      if (output.includes('\n')) resolve(output);
    });
    child.once('error', reject);
    child.once('exit', () => resolve(output));
  });
  child.stdin?.write('{"id":"check","op":"status"}\n');
  const line = (await answered).split('\n')[0] ?? '';
  child.stdin?.end();
  const parsed = JSON.parse(line) as { id?: string; event?: string };
  if (parsed.id !== 'check' || parsed.event !== 'status')
    throw new Error(`The voice helper answered "${line.slice(0, 200)}" to a status request.`);
}

async function stampFor(repoRoot: string, arch: MacArch): Promise<string> {
  return `${transcribeStamp(arch)}:${await macControlStamp(voicePackage(repoRoot))}`;
}

function swiftArgs(repoRoot: string, arch: MacArch, prefix: string): string[] {
  return [
    '-c',
    'release',
    '--arch',
    clangArch(arch),
    '--package-path',
    voicePackage(repoRoot),
    '--scratch-path',
    path.join(voiceCache(repoRoot), 'swift', arch),
    ...swiftLinkArgs(arch, prefix),
  ];
}

async function stageSupportFiles(repoRoot: string, built: string, prefix: string): Promise<void> {
  const models = path.join(built, 'models');
  const licenses = path.join(built, 'licenses');
  await mkdir(models, { recursive: true });
  await mkdir(licenses, { recursive: true });
  await cp(await downloadModel(repoRoot, VOICE_SILERO), path.join(models, VOICE_SILERO.file));
  await cp(path.join(prefix, 'LICENSE'), path.join(licenses, 'transcribe.cpp-LICENSE'));
  await cp(
    path.join(prefix, 'THIRD-PARTY-LICENSES.md'),
    path.join(licenses, 'transcribe.cpp-THIRD-PARTY-LICENSES.md'),
  );
  await cp(path.join(voicePackage(repoRoot), 'licenses'), licenses, { recursive: true });
}

export async function buildVoice(repoRoot: string, arch: MacArch): Promise<string> {
  const built = voiceBuiltDir(repoRoot, arch);
  const binary = path.join(built, VOICE_HELPER_NAME);
  const stamp = await stampFor(repoRoot, arch);
  const saved = await readFile(path.join(built, 'stamp'), 'utf8').catch(() => null);
  const current =
    saved === stamp &&
    (await voiceCheck(binary, arch).then(
      () => true,
      () => false,
    ));
  if (!current) {
    const prefix = await buildTranscribe(repoRoot, arch);
    console.log(`Building the voice helper for ${arch}.`);
    const env = swiftEnv(process.env);
    const args = swiftArgs(repoRoot, arch, prefix);
    await run('swift', ['build', ...args], { env, maxBuffer: BUFFER });
    const { stdout } = await run('swift', ['build', ...args, '--show-bin-path'], { env });
    await rm(built, { recursive: true, force: true });
    await mkdir(built, { recursive: true });
    await cp(path.join(stdout.trim(), VOICE_HELPER_NAME), binary);
    await run('codesign', ['--force', '--sign', '-', binary]);
    await stageSupportFiles(repoRoot, built, prefix);
    await writeFile(path.join(built, 'stamp'), stamp);
  }
  await voiceCheck(binary, arch);
  if (arch === (os.arch() === 'arm64' ? 'arm64' : 'x64')) await checkVoiceAnswers(binary);
  return built;
}

export async function testVoice(repoRoot: string): Promise<void> {
  const arch: MacArch = os.arch() === 'arm64' ? 'arm64' : 'x64';
  const prefix = await buildTranscribe(repoRoot, arch);
  await run(
    'swift',
    ['test', '--package-path', voicePackage(repoRoot), ...swiftLinkArgs(arch, prefix)],
    { env: swiftEnv(process.env), maxBuffer: BUFFER },
  );
}

export const VOICE_LICENSES = [
  'transcribe.cpp-LICENSE',
  'transcribe.cpp-THIRD-PARTY-LICENSES.md',
  'tinyblas-LICENSE',
  'whisper-weights-LICENSE',
  'parakeet-weights-LICENSE',
  'silero-vad-LICENSE',
] as const;

export async function stagedVoiceProblems(voiceDir: string): Promise<string[]> {
  const problems: string[] = [];
  const model = await readFile(path.join(voiceDir, 'models', VOICE_SILERO.file)).catch(() => null);
  if (!model) problems.push(`${VOICE_SILERO.file} is missing`);
  else if (createHash('sha256').update(model).digest('hex') !== VOICE_SILERO.sha256)
    problems.push(`${VOICE_SILERO.file} does not match its pinned sha256`);
  for (const license of VOICE_LICENSES) {
    const found = await readFile(path.join(voiceDir, 'licenses', license)).catch(() => null);
    if (!found) problems.push(`the ${license} notice is missing`);
  }
  return problems;
}

export async function checkStagedVoice(voiceDir: string, arch: MacArch): Promise<void> {
  await voiceCheck(path.join(voiceDir, 'bin', VOICE_HELPER_NAME), arch);
  const problems = await stagedVoiceProblems(voiceDir);
  if (problems.length > 0)
    throw new Error(`The voice bundle for ${arch} can't ship: ${problems.join('; ')}.`);
}

export async function stageVoice(
  builtDir: string,
  arch: MacArch,
  resources: string,
): Promise<void> {
  await voiceCheck(path.join(builtDir, VOICE_HELPER_NAME), arch);
  const target = path.join(resources, 'voice');
  await mkdir(path.join(target, 'bin'), { recursive: true });
  await cp(path.join(builtDir, VOICE_HELPER_NAME), path.join(target, 'bin', VOICE_HELPER_NAME));
  await cp(path.join(builtDir, 'models'), path.join(target, 'models'), { recursive: true });
  await cp(path.join(builtDir, 'licenses'), path.join(target, 'licenses'), { recursive: true });
}
