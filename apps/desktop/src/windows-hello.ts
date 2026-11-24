import { existsSync } from 'node:fs';
import type { OwnerAuthOutcome } from './owner-auth.ts';
import { startWinHelper, type WinHelper } from './win-helper/helper-process.ts';
import {
  HELLO_MESSAGE_MAX,
  WIN_HELPER_PROTOCOL,
  type HelloOutcome,
} from './win-helper/protocol.ts';

export interface WindowsHello {
  available(): boolean;
  refresh(): Promise<boolean>;
  verify(message: string, windowHandle: string | null): Promise<OwnerAuthOutcome>;
  dispose(): void;
}

export interface WindowsHelloOptions {
  binary: string;
  log(line: string): void;
  exists?: (file: string) => boolean;
  start?: (binary: string, log: (line: string) => void) => WinHelper;
}

const OUTCOME: Record<HelloOutcome, OwnerAuthOutcome> = {
  verified: 'ok',
  cancelled: 'cancelled',
  unavailable: 'unavailable',
  error: 'failed',
};

const MISSING: WindowsHello = {
  available: () => false,
  refresh: async () => false,
  verify: async () => 'unavailable',
  dispose: () => undefined,
};

const defaultStart = (binary: string, log: (line: string) => void) =>
  startWinHelper({ binary, log });

export function windowHandle(handle: Buffer | null | undefined): string | null {
  if (!handle) return null;
  if (handle.length >= 8) return handle.readBigUInt64LE(0).toString();
  if (handle.length >= 4) return String(handle.readUInt32LE(0));
  return null;
}

export function windowsHello(options: WindowsHelloOptions): WindowsHello {
  const exists = options.exists ?? existsSync;
  if (!exists(options.binary)) {
    options.log(
      `Windows Hello is unavailable: no Windows helper at ${options.binary}. Run pnpm desktop:win-helper.`,
    );
    return MISSING;
  }
  const helper = (options.start ?? defaultStart)(options.binary, options.log);
  let known = false;
  let asking: Promise<boolean> | null = null;
  let checkedProtocol = false;

  const ask = async (): Promise<boolean> => {
    if (!checkedProtocol) {
      const { protocol } = await helper.call({ op: 'status' });
      if (protocol !== WIN_HELPER_PROTOCOL) {
        options.log(
          `Windows Hello is unavailable: the Windows helper speaks protocol ${protocol}, not ${WIN_HELPER_PROTOCOL}.`,
        );
        return false;
      }
      checkedProtocol = true;
    }
    return (await helper.call({ op: 'hello.available' })).available;
  };

  const settle = (available: boolean): boolean => {
    const changed = available !== known;
    known = available;
    return changed;
  };

  const refresh = (): Promise<boolean> => {
    asking ??= ask()
      .catch((error: unknown) => {
        options.log(`Could not ask whether Windows Hello is set up: ${(error as Error).message}`);
        return false;
      })
      .then(settle)
      .finally(() => {
        asking = null;
      });
    return asking;
  };

  return {
    available: () => known,
    refresh,
    verify: async (message, handle) => {
      if (!known) return 'unavailable';
      try {
        const { outcome } = await helper.call({
          op: 'hello.verify',
          message: message.slice(0, HELLO_MESSAGE_MAX),
          window: handle,
        });
        if (outcome === 'error') options.log('Windows Hello could not verify the user.');
        return OUTCOME[outcome];
      } catch (error) {
        options.log(`Windows Hello failed: ${(error as Error).message}`);
        return 'failed';
      }
    },
    dispose: () => helper.kill(),
  };
}
