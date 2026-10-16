import path from 'node:path';

const MEDIA_GUARD_PRELOAD = 'media-guard-preload.cjs';
export const MEDIA_GUARD_ID = 'spark-media-guard';

export const RECORDING_PERMISSIONS: ReadonlySet<string> = new Set(['media', 'speaker-selection']);

export interface MediaGuardTarget {
  setPermissionRequestHandler(
    handler: (contents: unknown, permission: string, callback: (granted: boolean) => void) => void,
  ): void;
  setPermissionCheckHandler(handler: (contents: unknown, permission: string) => boolean): void;
  registerPreloadScript(script: { type: 'frame'; filePath: string; id: string }): string;
}

export function mediaGuardPreload(dir: string = import.meta.dirname): string {
  return path.join(dir, MEDIA_GUARD_PRELOAD);
}

const guarded = new WeakSet<object>();

export function guardSessionMedia(
  target: MediaGuardTarget,
  preload: string = mediaGuardPreload(),
): void {
  if (guarded.has(target)) return;
  guarded.add(target);
  target.setPermissionRequestHandler((_contents, permission, callback) =>
    callback(!RECORDING_PERMISSIONS.has(permission)),
  );
  target.setPermissionCheckHandler(
    (_contents, permission) => !RECORDING_PERMISSIONS.has(permission),
  );
  target.registerPreloadScript({ type: 'frame', filePath: preload, id: MEDIA_GUARD_ID });
}
