import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  VOICE_DEFAULT_SETTINGS,
  VOICE_SILERO,
  type VoiceSettings,
  type VoiceStatus,
} from '@spark-outpost/contracts';
import { fakeVoiceHelper } from './fake-helper.ts';
import { fakeVoiceModels } from './fake-models.ts';
import { startVoiceHelper, type VoiceHelper } from './helper-process.ts';
import { createVoice } from './voice.ts';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const RETIRED_FILES = [
  'ggml-base-q5_1.bin',
  'ggml-large-v3-turbo-q5_0.bin',
  '422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898.partial',
  '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2.partial',
];

async function setup(options: {
  downloaded?: boolean;
  retired?: boolean;
  settings?: Partial<VoiceSettings>;
}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'voice-models-'));
  dirs.push(dir);
  const { models, fetch } = fakeVoiceModels(5);
  const fetchSpy = vi.fn(fetch);
  const model = models[0]!;
  if (options.downloaded) {
    const response = await fetch(model.url, { signal: new AbortController().signal });
    await writeFile(path.join(dir, model.file), Buffer.from(await response.arrayBuffer()));
  }
  if (options.retired) {
    for (const name of RETIRED_FILES) await writeFile(path.join(dir, name), 'old');
    await writeFile(path.join(dir, VOICE_SILERO.file), 'vad');
  }
  const helper = startVoiceHelper({ spawn: fakeVoiceHelper, log: () => undefined });
  const loads: string[] = [];
  const watched: VoiceHelper = {
    ...helper,
    ask: (request, done) => {
      if (request.op === 'load') loads.push(path.basename(request.path));
      return helper.ask(request, done);
    },
  };
  const published: VoiceStatus[] = [];
  const saved: VoiceSettings[] = [];
  const voice = createVoice({
    helper: watched,
    helperExists: () => true,
    settings: { ...VOICE_DEFAULT_SETTINGS, enabled: true, ...options.settings },
    save: (settings) => saved.push(settings),
    micStatus: () => 'granted',
    askMic: vi.fn(async () => true),
    modelDir: dir,
    models,
    vadPath: '/vad.bin',
    fetch: fetchSpy,
    register: () => true,
    unregister: () => undefined,
    takenBy: () => null,
    sendTo: () => undefined,
    sendIsland: () => undefined,
    voiceOver: () => false,
    language: 'en',
    allowFileInput: false,
    changed: (status) => published.push(status),
    log: () => undefined,
  });
  await voice.start();
  return { voice, dir, loads, published, saved, models, fetchSpy };
}

const until = async (check: () => boolean) => {
  for (let tries = 0; tries < 200 && !check(); tries += 1)
    await new Promise((resolve) => setTimeout(resolve, 10));
  expect(check()).toBe(true);
};

async function close(scene: Awaited<ReturnType<typeof setup>>) {
  scene.voice.dispose();
  await until(() =>
    Object.values(scene.published.at(-1)?.models ?? {}).every(
      (model) => model.state !== 'downloading',
    ),
  );
}

describe('The speech model', () => {
  it('reports Parakeet as the one model, ready when its file is there', async () => {
    const scene = await setup({ downloaded: true });
    const status = await scene.voice.status();
    expect(status.settings.model).toBe('parakeet-v3');
    expect(Object.keys(status.models)).toEqual(['parakeet-v3']);
    expect(status.models['parakeet-v3'].state).toBe('ready');
    await close(scene);
  });

  it('downloads Parakeet at start when Voice is on and the file is missing', async () => {
    const scene = await setup({});
    await until(() => scene.fetchSpy.mock.calls.length === 1);
    expect(scene.fetchSpy.mock.calls[0]?.[0]).toBe(scene.models[0]!.url);
    await until(() => scene.published.at(-1)?.models['parakeet-v3'].state === 'ready');
    expect(scene.loads.at(-1)).toBe('parakeet-tdt-0.6b-v3-Q5_K_M.gguf');
    await close(scene);
  });

  it('never downloads at start while Voice is off', async () => {
    const scene = await setup({ settings: { enabled: false } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(scene.fetchSpy).not.toHaveBeenCalled();
    expect((await scene.voice.status()).models['parakeet-v3'].state).toBe('missing');
    await close(scene);
  });

  it('does not download at start when the file is already there', async () => {
    const scene = await setup({ downloaded: true });
    expect(scene.fetchSpy).not.toHaveBeenCalled();
    await close(scene);
  });

  it('starts no second download while one is running', async () => {
    const scene = await setup({});
    expect(scene.voice.download().models['parakeet-v3'].state).toBe('downloading');
    scene.voice.download();
    await scene.voice.turnOn();
    await until(() => scene.fetchSpy.mock.calls.length >= 1);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(scene.fetchSpy).toHaveBeenCalledTimes(1);
    await until(() => (scene.published.at(-1)?.models['parakeet-v3'].progress ?? 0) > 0);
    await close(scene);
  });

  it('cancelling a download deletes its partial file', async () => {
    const scene = await setup({});
    await until(() => (scene.published.at(-1)?.models['parakeet-v3'].progress ?? 0) > 0);
    scene.voice.cancelDownload();
    await until(() => scene.published.at(-1)?.models['parakeet-v3'].state === 'missing');
    expect(scene.published.at(-1)?.models['parakeet-v3'].problem).toBeNull();
    expect(await readdir(scene.dir)).toEqual([]);
    await close(scene);
  });

  it('turning on with no file starts the download and returns before it finishes', async () => {
    const scene = await setup({ settings: { enabled: false } });
    const status = await scene.voice.turnOn();
    expect(status.settings.enabled).toBe(true);
    expect(status.model).toBe('downloading');
    await until(() => scene.published.at(-1)?.model === 'ready');
    expect(scene.loads.at(-1)).toBe('parakeet-tdt-0.6b-v3-Q5_K_M.gguf');
    await close(scene);
  });

  it('turning Voice off cancels a download in progress', async () => {
    const scene = await setup({ settings: { enabled: false } });
    await scene.voice.turnOn();
    await scene.voice.turnOff();
    await until(() => scene.published.at(-1)?.models['parakeet-v3'].state === 'missing');
    expect(await readdir(scene.dir)).toEqual([]);
    await close(scene);
  });
});

describe('Retired speech models', () => {
  it('deletes the Whisper files and their partials at start, and nothing else', async () => {
    const scene = await setup({ retired: true, downloaded: true, settings: { enabled: false } });
    expect((await readdir(scene.dir)).sort()).toEqual(
      [VOICE_SILERO.file, scene.models[0]!.file].sort(),
    );
    await close(scene);
  });

  it('deletes them with Voice on too, and keeps the Parakeet file', async () => {
    const scene = await setup({ retired: true, downloaded: true });
    const left = await readdir(scene.dir);
    expect(left).toContain(scene.models[0]!.file);
    expect(left).toContain(VOICE_SILERO.file);
    for (const name of RETIRED_FILES) expect(left).not.toContain(name);
    await close(scene);
  });

  it('a user who had chosen Whisper gets Parakeet downloaded in the background', async () => {
    const scene = await setup({ retired: true });
    await until(() => scene.published.at(-1)?.models['parakeet-v3'].state === 'ready');
    expect(scene.saved).toEqual([]);
    expect((await readdir(scene.dir)).sort()).toEqual(
      [VOICE_SILERO.file, scene.models[0]!.file].sort(),
    );
    await close(scene);
  });
});
