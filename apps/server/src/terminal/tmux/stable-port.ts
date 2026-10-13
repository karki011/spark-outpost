import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function savedPort(file: string): number {
  try {
    const port = Number(readFileSync(file, 'utf8').trim());
    return Number.isInteger(port) && port > 1023 && port < 65_536 ? port : 0;
  } catch {
    return 0;
  }
}

export function savePort(file: string, port: number): void {
  try {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(file, String(port), { mode: 0o600 });
  } catch {
    return;
  }
}
