import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { stagedVoiceProblems, swiftLinkArgs, VOICE_LICENSES, whisperCmakeArgs } from './voice-bundle.ts';

const made: string[] = [];
afterEach(async () => {
  await Promise.all(made.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('whisper.cpp build', () => {
  it('builds static libraries with no OpenMP and nothing from Homebrew', () => {
    const args = whisperCmakeArgs('arm64', '/src', '/build', '/prefix');
    expect(args).toContain('-DBUILD_SHARED_LIBS=OFF');
    expect(args).toContain('-DGGML_OPENMP=OFF');
    expect(args).toContain('-DCMAKE_OSX_DEPLOYMENT_TARGET=12.0');
    expect(args.find((arg) => arg.startsWith('-DCMAKE_IGNORE_PREFIX_PATH='))).toContain(
      '/opt/homebrew',
    );
  });

  it('uses Metal on Apple silicon and AVX on Intel', () => {
    const arm = whisperCmakeArgs('arm64', '/s', '/b', '/p');
    const intel = whisperCmakeArgs('x64', '/s', '/b', '/p');
    expect(arm).toEqual(expect.arrayContaining(['-DGGML_METAL=ON', '-DCMAKE_OSX_ARCHITECTURES=arm64']));
    expect(intel).toEqual(
      expect.arrayContaining(['-DGGML_METAL=OFF', '-DGGML_AVX2=ON', '-DCMAKE_OSX_ARCHITECTURES=x86_64']),
    );
    expect(swiftLinkArgs('x64', '/p')).not.toContain('-lggml-metal');
    expect(swiftLinkArgs('arm64', '/p')).toContain('-lggml-metal');
  });
});

describe('staged voice files', () => {
  it('names a missing VAD model and missing notices', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'voice-stage-'));
    made.push(dir);
    await mkdir(path.join(dir, 'licenses'), { recursive: true });
    await writeFile(path.join(dir, 'licenses', VOICE_LICENSES[0]), 'MIT');
    expect(await stagedVoiceProblems(dir)).toEqual([
      'ggml-silero-v6.2.0.bin is missing',
      'the whisper-weights-LICENSE notice is missing',
      'the silero-vad-LICENSE notice is missing',
    ]);
  });

  it('refuses a VAD model that is not the pinned one', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'voice-stage-'));
    made.push(dir);
    await mkdir(path.join(dir, 'models'), { recursive: true });
    await mkdir(path.join(dir, 'licenses'), { recursive: true });
    await writeFile(path.join(dir, 'models', 'ggml-silero-v6.2.0.bin'), 'not the model');
    for (const license of VOICE_LICENSES) await writeFile(path.join(dir, 'licenses', license), 'MIT');
    expect(await stagedVoiceProblems(dir)).toEqual([
      'ggml-silero-v6.2.0.bin does not match its pinned sha256',
    ]);
  });
});
