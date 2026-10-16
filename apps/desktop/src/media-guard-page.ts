interface PageScope {
  MediaDevices?: { prototype: object };
  navigator?: { mediaDevices?: object };
}

export function guardMediaInPage(scope: PageScope = globalThis as unknown as PageScope): void {
  const refusal = () =>
    new DOMException(
      'Spark Outpost does not give pages the microphone or camera.',
      'NotAllowedError',
    );
  const lock = (target: object | undefined, key: string, value: unknown) => {
    if (!target) return;
    try {
      Object.defineProperty(target, key, { value, writable: false, configurable: false });
    } catch {
      return;
    }
  };
  const refuse = () => Promise.reject(refusal());
  lock(scope.MediaDevices?.prototype, 'getUserMedia', refuse);
  lock(scope.navigator?.mediaDevices, 'getUserMedia', refuse);
  const legacy = (_constraints: unknown, _ok: unknown, fail?: (error: DOMException) => void) => {
    if (typeof fail === 'function') queueMicrotask(() => fail(refusal()));
  };
  const navigatorObject = scope.navigator;
  for (const key of ['getUserMedia', 'webkitGetUserMedia']) {
    if (navigatorObject && key in navigatorObject) lock(navigatorObject, key, legacy);
  }
}
