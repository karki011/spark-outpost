import { mkdtemp, rm, truncate, writeFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  VOICE_DEFAULT_SETTINGS,
  VOICE_WHISPER_BASE,
  type VoiceEvent,
  type VoiceMicPermission,
} from '@spark-outpost/contracts';
import { fakeVoiceHelper } from './fake-helper.ts';
import { startVoiceHelper } from './helper-process.ts';
import { createVoice } from './voice.ts';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function setup(
  options: { model?: boolean; mic?: VoiceMicPermission; enabled?: boolean } = {},
) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'voice-'));
  dirs.push(dir);
  if (options.model !== false) {
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, VOICE_WHISPER_BASE.file);
    await writeFile(file, '');
    await truncate(file, VOICE_WHISPER_BASE.size);
  }
  const sent: { owner: number; event: VoiceEvent }[] = [];
  const island: VoiceEvent[] = [];
  const registered = new Map<string, () => void>();
  const saved: unknown[] = [];
  let mic: VoiceMicPermission = options.mic ?? 'granted';
  const helper = startVoiceHelper({ spawn: fakeVoiceHelper, log: () => undefined });
  const voice = createVoice({
    helper,
    helperExists: () => true,
    settings: { ...VOICE_DEFAULT_SETTINGS, enabled: options.enabled ?? false },
    save: (settings) => saved.push(settings),
    micStatus: () => mic,
    askMic: vi.fn(async () => {
      mic = 'granted';
      return true;
    }),
    modelDir: dir,
    vadPath: '/vad.bin',
    fetch: vi.fn(async () => new Response('nope', { status: 500 })),
    register: (accelerator, run) => {
      registered.set(accelerator, run);
      return true;
    },
    unregister: (accelerator) => registered.delete(accelerator),
    sendTo: (owner, event) => sent.push({ owner, event }),
    sendIsland: (event) => island.push(event),
    voiceOver: () => false,
    language: 'en',
    allowFileInput: false,
    changed: () => undefined,
    log: () => undefined,
  });
  return { voice, sent, island, registered, saved, helper, dir };
}

const settle = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Voice', () => {
  it('stays off and holds no shortcut until it is turned on', async () => {
    const scene = await setup();
    expect(await scene.voice.listen(1, 'command', '', undefined)).toEqual({
      ok: false,
      error: 'invalid',
    });
    expect(scene.registered.size).toBe(0);
    scene.voice.dispose();
  });

  it('turning on asks for the microphone, loads the model and binds ⌥⇧V', async () => {
    const scene = await setup({ mic: 'not_determined' });
    const status = await scene.voice.turnOn();
    expect(status.settings.enabled).toBe(true);
    expect(status.mic).toBe('granted');
    expect(status.model).toBe('ready');
    expect([...scene.registered.keys()]).toEqual(['Alt+Shift+V']);
    scene.voice.dispose();
  });

  it('a failed download keeps Voice from listening and says why', async () => {
    const scene = await setup({ model: false });
    const status = await scene.voice.turnOn();
    expect(status.model).toBe('failed');
    expect(status.problem).toBe('The download failed (500).');
    expect(await scene.voice.listen(1, 'command', '', undefined)).toEqual({
      ok: false,
      error: 'model_missing',
    });
    scene.voice.dispose();
  });

  it('sends a command’s events only to the window that asked', async () => {
    const scene = await setup({ enabled: true });
    const result = await scene.voice.listen(7, 'command', 'spark-outpost', undefined);
    expect(result.ok).toBe(true);
    await settle();
    const kinds = scene.sent.map((entry) => [entry.owner, entry.event.kind]);
    expect(kinds).toEqual([
      [7, 'level'],
      [7, 'speech'],
      [7, 'final'],
    ]);
    expect(scene.sent.at(-1)?.event).toMatchObject({ text: 'who needs me', reason: 'paused' });
    scene.voice.dispose();
  });

  it('a press while listening stops the listen instead of starting another', async () => {
    const scene = await setup({ enabled: true });
    const result = await scene.voice.listen(3, 'dictation', '', undefined);
    if (!result.ok) throw new Error('not listening');
    scene.voice.press();
    await settle(50);
    expect(scene.island).toEqual([]);
    expect(scene.sent.at(-1)?.event).toMatchObject({ kind: 'final', reason: 'stopped' });
    scene.voice.press();
    expect(scene.island).toEqual([{ kind: 'press' }]);
    scene.voice.dispose();
  });

  it('only one listen at a time, and only its window can stop or cancel it', async () => {
    const scene = await setup({ enabled: true });
    const first = await scene.voice.listen(1, 'dictation', '', undefined);
    if (!first.ok) throw new Error('not listening');
    expect(await scene.voice.listen(2, 'dictation', '', undefined)).toEqual({
      ok: false,
      error: 'busy',
    });
    scene.voice.cancel(2, first.id);
    await settle(50);
    expect(scene.sent.some((entry) => entry.event.kind === 'cancelled')).toBe(false);
    scene.voice.cancel(1, first.id);
    await settle(50);
    expect(scene.sent.at(-1)).toEqual({ owner: 1, event: { kind: 'cancelled', id: first.id } });
    scene.voice.dispose();
  });

  it('refuses file input unless the dev host allowed it', async () => {
    const scene = await setup({ enabled: true });
    expect(await scene.voice.listen(1, 'command', '', '/tmp/a.wav')).toEqual({
      ok: false,
      error: 'file_input_off',
    });
    scene.voice.dispose();
  });

  it('speaks answers only with Speak answers on, and a press hushes them', async () => {
    const scene = await setup({ enabled: true });
    expect(scene.voice.speak(1, 'Nothing needs you right now.')).toBeNull();
    await scene.voice.update({ speakAnswers: true });
    const id = scene.voice.speak(1, 'Nothing needs you right now.');
    expect(id).not.toBeNull();
    scene.voice.press();
    await settle(50);
    expect(scene.sent).toContainEqual({
      owner: 1,
      event: { kind: 'spoken', id, interrupted: true },
    });
    expect(scene.island).toEqual([{ kind: 'press' }]);
    scene.voice.dispose();
  });

  it('turning off cancels listening, unbinds the shortcut and stops the helper', async () => {
    const scene = await setup({ enabled: true });
    await scene.voice.start();
    const result = await scene.voice.listen(1, 'dictation', '', undefined);
    if (!result.ok) throw new Error('not listening');
    const status = await scene.voice.turnOff();
    expect(status.settings.enabled).toBe(false);
    expect(scene.registered.size).toBe(0);
    expect(scene.helper.running()).toBe(false);
    expect(scene.saved.at(-1)).toMatchObject({ enabled: false });
  });

  it('a helper that exits fails the open listen and reloads the model next time', async () => {
    const scene = await setup({ enabled: true });
    const result = await scene.voice.listen(4, 'dictation', '', undefined);
    if (!result.ok) throw new Error('not listening');
    scene.helper.kill();
    expect(scene.sent.at(-1)).toEqual({
      owner: 4,
      event: { kind: 'error', id: result.id, error: 'failed' },
    });
    expect((await scene.voice.listen(4, 'command', '', undefined)).ok).toBe(true);
    scene.voice.dispose();
  });
});
