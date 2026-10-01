import { describe, expect, it } from 'vitest';
import type { UpdateEvent } from './update-state.ts';
import { PREVIEW_VERSION, previewDriver, previewPhase } from './update-preview.ts';

describe('update preview for the dev app', () => {
  it('accepts only the preview states it can show', () => {
    expect(previewPhase('available')).toBe('available');
    expect(previewPhase('ready')).toBe('ready');
    expect(previewPhase('installing')).toBeNull();
    expect(previewPhase(undefined)).toBeNull();
  });

  it('offers a fake version, downloads it with progress and quits instead of installing', async () => {
    const events: UpdateEvent[] = [];
    let quits = 0;
    const driver = previewDriver(
      (event) => events.push(event),
      () => {
        quits += 1;
      },
    );
    expect(await driver.check()).toBe(PREVIEW_VERSION);
    await driver.download();
    expect(events.at(-1)).toEqual({ type: 'downloaded', version: PREVIEW_VERSION });
    expect(events.filter((event) => event.type === 'progress').length).toBeGreaterThan(3);
    driver.install(true);
    expect(quits).toBe(0);
    driver.install(false);
    expect(quits).toBe(1);
  });
});
