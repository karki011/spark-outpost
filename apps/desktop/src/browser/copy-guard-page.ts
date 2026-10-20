interface PageScope {
  Document?: { prototype: object };
}

type ExecCommand = (this: unknown, command: string, ...rest: unknown[]) => boolean;

export function guardCopyInPage(
  allowed: () => boolean,
  scope: PageScope = globalThis as unknown as PageScope,
): void {
  const prototype = scope.Document?.prototype as { execCommand?: ExecCommand } | undefined;
  const original = prototype?.execCommand;
  if (!prototype || typeof original !== 'function') return;
  const writes = new Set(['copy', 'cut']);
  const execCommand: ExecCommand = function (command, ...rest) {
    if (writes.has(String(command).toLowerCase()) && !allowed()) return false;
    return original.call(this, command, ...rest);
  };
  try {
    Object.defineProperty(prototype, 'execCommand', {
      value: execCommand,
      writable: false,
      configurable: false,
    });
  } catch {
    return;
  }
}
