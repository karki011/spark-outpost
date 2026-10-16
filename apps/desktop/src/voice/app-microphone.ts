interface PermissionTarget {
  setPermissionRequestHandler(
    handler: (contents: unknown, permission: string, callback: (granted: boolean) => void) => void,
  ): void;
  setPermissionCheckHandler(handler: (contents: unknown, permission: string) => boolean): void;
}

export const RECORDING_PERMISSIONS: ReadonlySet<string> = new Set(['media', 'speaker-selection']);

export function denyAppRecording(target: PermissionTarget): void {
  target.setPermissionRequestHandler((_contents, permission, callback) =>
    callback(!RECORDING_PERMISSIONS.has(permission)),
  );
  target.setPermissionCheckHandler((_contents, permission) => !RECORDING_PERMISSIONS.has(permission));
}
