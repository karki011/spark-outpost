import { mkdtemp, rm, truncate, writeFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  VOICE_DEFAULT_SETTINGS,
  VOICE_MODELS,
  VOICE_PARAKEET_V3,
  type VoiceEvent,
  type VoiceMicPermission,
  type VoiceStatus,
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
    const file = path.join(dir, VOICE_PARAKEET_V3.file);
    await writeFile(file, '');
    await truncate(file, VOICE_PARAKEET_V3.size);
  }
  const sent: { owner: number; event: VoiceEvent }[] = [];
  const island: VoiceEvent[] = [];
  const focused: VoiceEvent[] = [];
  const view = { target: false };
  const registered = new Map<string, () => void>();
  const elsewhere = new Set<string>();
  const saved: unknown[] = [];
  const published: VoiceStatus[] = [];
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
    models: VOICE_MODELS,
    vadPath: '/vad.bin',
    fetch: vi.fn(async () => new Response('nope', { status: 500 })),
    register: (accelerator, run) => {
      if (elsewhere.has(accelerator)) return false;
      registered.set(accelerator, run);
      return true;
    },
    unregister: (accelerator) => registered.delete(accelerator),
    takenBy: (accelerator) => (accelerator === 'Alt+Space' ? 'Quick chat' : null),
    sendTo: (owner, event) => sent.push({ owner, event }),
    sendIsland: (event) => island.push(event),
    sendFocused: (event) => {
      if (!view.target) return false;
      focused.push(event);
      return true;
    },
    voiceOver: () => false,
    language: 'en',
    allowFileInput: false,
    changed: (status) => published.push(status),
    log: () => undefined,
  });
  return {
    voice,
    sent,
    island,
    focused,
    view,
    registered,
    elsewhere,
    saved,
    helper,
    dir,
    published,
  };
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

  it('a new shortcut replaces the old one, is saved, and Reset brings back ⌥⇧V', async () => {
    const scene = await setup();
    await scene.voice.turnOn();
    const changed = scene.voice.setShortcut('Control+Alt+M');
    expect(changed.error).toBeNull();
    expect(changed.status.settings.shortcut).toBe('Control+Alt+M');
    expect([...scene.registered.keys()]).toEqual(['Control+Alt+M']);
    expect(scene.saved.at(-1)).toMatchObject({ shortcut: 'Control+Alt+M' });
    scene.registered.get('Control+Alt+M')!();
    expect(scene.island.at(-1)).toEqual({ kind: 'press' });
    expect(scene.voice.setShortcut(null).status.settings.shortcut).toBe('Alt+Shift+V');
    expect([...scene.registered.keys()]).toEqual(['Alt+Shift+V']);
    scene.voice.dispose();
  });

  it('refuses a shortcut with no modifier, one Spark uses, or one another app holds', async () => {
    const scene = await setup();
    await scene.voice.turnOn();
    scene.elsewhere.add('Control+Alt+M');
    expect(scene.voice.setShortcut('M').error).toMatch(/modifier/);
    expect(scene.voice.setShortcut('Alt+Space').error).toBe(
      'This shortcut already opens Quick chat.',
    );
    const taken = scene.voice.setShortcut('Control+Alt+M');
    expect(taken.error).toMatch(/Another app/);
    expect(taken.status.settings.shortcut).toBe('Alt+Shift+V');
    expect(taken.status.shortcutFailed).toBe(false);
    expect([...scene.registered.keys()]).toEqual(['Alt+Shift+V']);
    scene.voice.dispose();
  });

  it('a shortcut picked while Voice is off is saved and bound when it turns on', async () => {
    const scene = await setup();
    expect(scene.voice.setShortcut('Control+Alt+M').error).toBeNull();
    expect(scene.registered.size).toBe(0);
    await scene.voice.turnOn();
    expect([...scene.registered.keys()]).toEqual(['Control+Alt+M']);
    scene.voice.dispose();
  });

  it('a failed download keeps Voice from listening and says why', async () => {
    const scene = await setup({ model: false });
    const status = await scene.voice.turnOn();
    expect(status.model).toBe('downloading');
    expect(status.settings.enabled).toBe(true);
    await settle(50);
    expect(scene.published.at(-1)?.models['parakeet-v3']).toEqual({
      state: 'failed',
      progress: null,
      problem: 'The download failed (500).',
    });
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
      [7, 'partial'],
      [7, 'partial'],
      [7, 'partial'],
      [7, 'final'],
    ]);
    expect(
      scene.sent.filter((entry) => entry.event.kind === 'partial').at(-1)?.event,
    ).toMatchObject({ text: 'who needs me' });
    expect(scene.sent.at(-1)?.event).toMatchObject({ text: 'who needs me', reason: 'paused' });
    scene.voice.dispose();
  });

  it('a press goes to the focused Spark window when it has an input, else to the island', async () => {
    const scene = await setup({ enabled: true });
    await scene.voice.start();
    scene.view.target = true;
    scene.voice.press();
    expect(scene.focused).toEqual([{ kind: 'press' }]);
    expect(scene.island).toEqual([]);
    scene.view.target = false;
    scene.voice.press();
    expect(scene.island).toEqual([{ kind: 'press' }]);
  });

  it('a window with no input on screen can hand its press to the island', async () => {
    const scene = await setup({ enabled: true });
    await scene.voice.start();
    scene.voice.pressIsland();
    expect(scene.island).toEqual([{ kind: 'press' }]);
  });

  it('hands nothing to the island while Voice is off', async () => {
    const scene = await setup();
    await scene.voice.start();
    scene.voice.pressIsland();
    expect(scene.island).toEqual([]);
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

  it('a cancel drops the listen at once, so the next press opens a fresh one', async () => {
    const scene = await setup({ enabled: true });
    const orphan = await scene.voice.listen(5, 'command', '', undefined);
    if (!orphan.ok) throw new Error('not listening');
    scene.voice.cancel(5, orphan.id);
    expect(scene.sent.at(-1)).toEqual({ owner: 5, event: { kind: 'cancelled', id: orphan.id } });
    scene.voice.press();
    expect(scene.island).toEqual([{ kind: 'press' }]);
    const fresh = await scene.voice.listen(5, 'command', '', undefined);
    expect(fresh.ok).toBe(true);
    scene.voice.dispose();
  });

  it('Fn twice is watched again after the helper exits and comes back', async () => {
    const scene = await setup({ enabled: true });
    await scene.voice.update({ shortcutMode: 'fn' });
    expect((await scene.voice.status()).fnActive).toBe(true);
    scene.published.length = 0;
    scene.helper.kill();
    await settle(100);
    expect(scene.published.at(-1)?.fnActive).toBe(true);
    expect(scene.helper.running()).toBe(true);
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
