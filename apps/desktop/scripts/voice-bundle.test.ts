import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  linkManifestProblem,
  stagedVoiceProblems,
  swiftLinkArgs,
  transcribeCmakeArgs,
  VOICE_LICENSES,
} from './voice-bundle.ts';

const made: string[] = [];
afterEach(async () => {
  await Promise.all(made.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('transcribe.cpp build', () => {
  it('builds static libraries with no OpenMP, no examples and nothing from Homebrew', () => {
    const args = transcribeCmakeArgs('arm64', '/src', '/build', '/prefix');
    expect(args).toEqual(
      expect.arrayContaining([
        '-DTRANSCRIBE_BUILD_SHARED=OFF',
        '-DTRANSCRIBE_USE_OPENMP=OFF',
        '-DTRANSCRIBE_BUILD_EXAMPLES=OFF',
        '-DTRANSCRIBE_BUILD_TESTS=OFF',
        '-DCMAKE_OSX_DEPLOYMENT_TARGET=12.0',
      ]),
    );
    expect(args.find((arg) => arg.startsWith('-DCMAKE_IGNORE_PREFIX_PATH='))).toContain(
      '/opt/homebrew',
    );
  });

  it('uses Metal on Apple silicon and AVX2 without Metal on Intel', () => {
    const arm = transcribeCmakeArgs('arm64', '/s', '/b', '/p');
    const intel = transcribeCmakeArgs('x64', '/s', '/b', '/p');
    expect(arm).toEqual(
      expect.arrayContaining(['-DTRANSCRIBE_METAL=ON', '-DCMAKE_OSX_ARCHITECTURES=arm64']),
    );
    expect(intel).toEqual(
      expect.arrayContaining([
        '-DTRANSCRIBE_METAL=OFF',
        '-DGGML_AVX2=ON',
        '-DCMAKE_OSX_ARCHITECTURES=x86_64',
      ]),
    );
    expect(swiftLinkArgs('x64', '/p')).not.toContain('-lggml-metal');
    expect(swiftLinkArgs('arm64', '/p')).toContain('-lggml-metal');
  });

  it('refuses a build whose link manifest names other libraries', () => {
    const manifest = (libraries: string[]) => JSON.stringify({ libraries });
    expect(
      linkManifestProblem(
        manifest(['transcribe', 'ggml', 'ggml-cpu', 'ggml-metal', 'ggml-base']),
        'arm64',
      ),
    ).toBeNull();
    expect(
      linkManifestProblem(manifest(['transcribe', 'ggml', 'ggml-cpu', 'ggml-base']), 'x64'),
    ).toBeNull();
    expect(
      linkManifestProblem(
        manifest(['transcribe', 'ggml', 'ggml-cpu', 'ggml-blas', 'ggml-base']),
        'x64',
      ),
    ).toContain('ggml-blas');
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
      'the transcribe.cpp-THIRD-PARTY-LICENSES.md notice is missing',
      'the tinyblas-LICENSE notice is missing',
      'the whisper-weights-LICENSE notice is missing',
      'the parakeet-weights-LICENSE notice is missing',
      'the silero-vad-LICENSE notice is missing',
    ]);
  });

  it('refuses a VAD model that is not the pinned one', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'voice-stage-'));
    made.push(dir);
    await mkdir(path.join(dir, 'models'), { recursive: true });
    await mkdir(path.join(dir, 'licenses'), { recursive: true });
    await writeFile(path.join(dir, 'models', 'ggml-silero-v6.2.0.bin'), 'not the model');
    for (const license of VOICE_LICENSES)
      await writeFile(path.join(dir, 'licenses', license), 'MIT');
    expect(await stagedVoiceProblems(dir)).toEqual([
      'ggml-silero-v6.2.0.bin does not match its pinned sha256',
    ]);
  });
});
