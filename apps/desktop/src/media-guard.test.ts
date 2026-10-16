import { describe, expect, it } from 'vitest';
import { guardMediaInPage } from './media-guard-page.ts';
import { guardSessionMedia, mediaGuardPreload } from './media-guard.ts';

function fakePage() {
  const opened: string[] = [];
  class MediaDevices {
    getUserMedia(): Promise<string> {
      opened.push('stream');
      return Promise.resolve('stream');
    }
  }
  const navigator = {
    mediaDevices: new MediaDevices(),
    webkitGetUserMedia: () => opened.push('legacy stream'),
  };
  const scope = { MediaDevices, navigator };
  return { scope, opened, MediaDevices, navigator };
}

describe('guardMediaInPage', () => {
  it('rejects getUserMedia at once with NotAllowedError and opens nothing', async () => {
    const page = fakePage();
    guardMediaInPage(page.scope);
    await expect(page.navigator.mediaDevices.getUserMedia()).rejects.toMatchObject({
      name: 'NotAllowedError',
    });
    expect(page.opened).toEqual([]);
  });

  it('closes the prototype and legacy routes too, and a page cannot put them back', async () => {
    const page = fakePage();
    guardMediaInPage(page.scope);
    const viaPrototype = page.MediaDevices.prototype.getUserMedia.call(page.navigator.mediaDevices);
    await expect(viaPrototype).rejects.toMatchObject({ name: 'NotAllowedError' });
    const failed = await new Promise<string>((resolve) =>
      (
        page.navigator.webkitGetUserMedia as unknown as (
          constraints: unknown,
          ok: () => void,
          fail: (error: DOMException) => void,
        ) => void
      )(
        { audio: true },
        () => resolve('stream'),
        (error) => resolve(error.name),
      ),
    );
    expect(failed).toBe('NotAllowedError');
    expect(() => {
      Object.defineProperty(page.MediaDevices.prototype, 'getUserMedia', { value: () => 1 });
    }).toThrow();
    expect(page.opened).toEqual([]);
  });
});

describe('guardSessionMedia', () => {
  it('denies the microphone, keeps other permissions, and loads the guard in every frame', () => {
    let request:
      | ((contents: unknown, permission: string, callback: (granted: boolean) => void) => void)
      | null = null;
    let check: ((contents: unknown, permission: string) => boolean) | null = null;
    const preloads: { type: string; filePath: string }[] = [];
    const target = {
      setPermissionRequestHandler: (handler: typeof request) => void (request = handler),
      setPermissionCheckHandler: (handler: typeof check) => void (check = handler),
      registerPreloadScript: (script: { type: 'frame'; filePath: string; id: string }) => {
        preloads.push(script);
        return script.id;
      },
    };
    guardSessionMedia(target, '/app/dist/media-guard-preload.cjs');
    guardSessionMedia(target, '/app/dist/media-guard-preload.cjs');
    const answers: Record<string, boolean> = {};
    for (const permission of ['media', 'speaker-selection', 'notifications'])
      request!(null, permission, (granted) => void (answers[permission] = granted));
    expect(answers).toEqual({ media: false, 'speaker-selection': false, notifications: true });
    expect(check!(null, 'media')).toBe(false);
    expect(check!(null, 'clipboard-read')).toBe(true);
    expect(preloads).toEqual([
      { type: 'frame', filePath: '/app/dist/media-guard-preload.cjs', id: 'spark-media-guard' },
    ]);
  });

  it('points at the bundled guard beside main', () => {
    expect(mediaGuardPreload('/app/dist')).toBe('/app/dist/media-guard-preload.cjs');
  });
});
