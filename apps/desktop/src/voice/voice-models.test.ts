import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  VOICE_DEFAULT_SETTINGS,
  type VoiceModelId,
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

async function setup(options: { downloaded?: VoiceModelId[]; settings?: Partial<VoiceSettings> }) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'voice-models-'));
  dirs.push(dir);
  const { models, fetch } = fakeVoiceModels(5);
  for (const id of options.downloaded ?? []) {
    const model = models.find((each) => each.id === id)!;
    const response = await fetch(model.url, { signal: new AbortController().signal });
    await writeFile(path.join(dir, model.file), Buffer.from(await response.arrayBuffer()));
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
    fetch,
    register: () => true,
    unregister: () => undefined,
    sendTo: () => undefined,
    sendIsland: () => undefined,
    voiceOver: () => false,
    language: 'en',
    arch: 'arm64',
    allowFileInput: false,
    changed: (status) => published.push(status),
    log: () => undefined,
  });
  await voice.start();
  return { voice, dir, loads, published, saved, models };
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

describe('Speech models', () => {
  it('reports every model, which one is in use and the Mac’s arch', async () => {
    const scene = await setup({ downloaded: ['whisper-base'] });
    const status = await scene.voice.status();
    expect(status.settings.model).toBe('whisper-base');
    expect(status.arch).toBe('arm64');
    expect(status.models['whisper-base'].state).toBe('ready');
    expect(status.models['parakeet-v3'].state).toBe('missing');
    await close(scene);
  });

  it('selecting a downloaded model switches to it and loads it', async () => {
    const scene = await setup({ downloaded: ['whisper-base', 'whisper-large-v3-turbo'] });
    const status = await scene.voice.select('whisper-large-v3-turbo');
    expect(status.settings.model).toBe('whisper-large-v3-turbo');
    expect(scene.saved.at(-1)?.model).toBe('whisper-large-v3-turbo');
    expect(scene.loads.at(-1)).toBe('ggml-large-v3-turbo-q5_0.bin');
    expect((await scene.voice.listen(1, 'command', '', undefined)).ok).toBe(true);
    await close(scene);
  });

  it('selecting a model that isn’t downloaded downloads it, then switches when it checks out', async () => {
    const scene = await setup({ downloaded: ['whisper-base'] });
    const status = await scene.voice.select('parakeet-v3');
    expect(status.settings.model).toBe('whisper-base');
    expect(status.models['parakeet-v3'].state).toBe('downloading');
    await until(() => scene.published.at(-1)?.settings.model === 'parakeet-v3');
    expect(scene.published.at(-1)?.models['parakeet-v3'].state).toBe('ready');
    expect(scene.loads.at(-1)).toBe('parakeet-tdt-0.6b-v3-Q5_K_M.gguf');
    await close(scene);
  });

  it('a listen in progress keeps its model; the next listen loads the new one', async () => {
    const scene = await setup({ downloaded: ['whisper-base', 'whisper-large-v3-turbo'] });
    const listen = await scene.voice.listen(1, 'dictation', '', undefined);
    if (!listen.ok) throw new Error('not listening');
    const before = scene.loads.length;
    await scene.voice.select('whisper-large-v3-turbo');
    expect(scene.loads).toHaveLength(before);
    scene.voice.stop(1, listen.id);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await scene.voice.listen(1, 'command', '', undefined)).ok).toBe(true);
    expect(scene.loads.at(-1)).toBe('ggml-large-v3-turbo-q5_0.bin');
    await close(scene);
  });

  it('cancelling a download deletes its partial file and keeps the model in use', async () => {
    const scene = await setup({ downloaded: ['whisper-base'] });
    await scene.voice.select('parakeet-v3');
    await until(() => (scene.published.at(-1)?.models['parakeet-v3'].progress ?? 0) > 0);
    scene.voice.cancelDownload('parakeet-v3');
    await until(() => scene.published.at(-1)?.models['parakeet-v3'].state === 'missing');
    expect(scene.published.at(-1)?.models['parakeet-v3'].problem).toBeNull();
    expect(scene.published.at(-1)?.settings.model).toBe('whisper-base');
    expect(await readdir(scene.dir)).toEqual(['ggml-base-q5_1.bin']);
    await close(scene);
  });

  it('one download at a time', async () => {
    const scene = await setup({ downloaded: ['whisper-base'] });
    scene.voice.download('parakeet-v3');
    const status = scene.voice.download('whisper-large-v3-turbo');
    expect(status.models['whisper-large-v3-turbo'].state).toBe('missing');
    expect(status.models['parakeet-v3'].state).toBe('downloading');
    await close(scene);
  });

  it('a new choice replaces a pending switch’s download', async () => {
    const scene = await setup({ downloaded: ['whisper-base'] });
    await scene.voice.select('parakeet-v3');
    const status = await scene.voice.select('whisper-large-v3-turbo');
    expect(status.models['parakeet-v3'].state).toBe('missing');
    await until(() => scene.published.at(-1)?.settings.model === 'whisper-large-v3-turbo');
    await close(scene);
  });

  it('removes a downloaded model’s file, never the one in use', async () => {
    const scene = await setup({ downloaded: ['whisper-base', 'parakeet-v3'] });
    let status = await scene.voice.remove('whisper-base');
    expect(status.models['whisper-base'].state).toBe('ready');
    status = await scene.voice.remove('parakeet-v3');
    expect(status.models['parakeet-v3'].state).toBe('missing');
    expect(await readdir(scene.dir)).toEqual(['ggml-base-q5_1.bin']);
    await close(scene);
  });

  it('turning on with a model from onboarding returns before the download finishes', async () => {
    const scene = await setup({ settings: { enabled: false } });
    const status = await scene.voice.turnOn('parakeet-v3');
    expect(status.settings).toMatchObject({ enabled: true, model: 'parakeet-v3' });
    expect(status.model).toBe('downloading');
    await until(() => scene.published.at(-1)?.model === 'ready');
    expect(scene.loads.at(-1)).toBe('parakeet-tdt-0.6b-v3-Q5_K_M.gguf');
    await close(scene);
  });

  it('turning Voice off cancels a download in progress', async () => {
    const scene = await setup({ settings: { enabled: false } });
    await scene.voice.turnOn('parakeet-v3');
    await scene.voice.turnOff();
    await until(() => scene.published.at(-1)?.models['parakeet-v3'].state === 'missing');
    expect(await readdir(scene.dir)).toEqual([]);
    await close(scene);
  });
});
