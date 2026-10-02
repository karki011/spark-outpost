import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { redactText } from '@spark-outpost/contracts';

export const LOG_NAME = 'spark-outpost';
const MAX_BYTES = 2 * 1024 * 1024;
const KEEP_FILES = 4;

export interface FileLogOptions {
  dir: string;
  name?: string;
  maxBytes?: number;
  keep?: number;
  now?: () => Date;
}

const KEY_START = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const KEY_END = /-----END [A-Z ]*PRIVATE KEY-----/;

export function logFileName(name: string, index: number): string {
  return index === 0 ? `${name}.log` : `${name}.${index}.log`;
}

function sizeOf(file: string): number {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
}

export class FileLog {
  private readonly dir: string;
  private readonly name: string;
  private readonly maxBytes: number;
  private readonly keep: number;
  private readonly now: () => Date;
  private size: number | null = null;
  private broken = false;
  private inPrivateKey = false;

  constructor(options: FileLogOptions) {
    this.dir = options.dir;
    this.name = options.name ?? LOG_NAME;
    this.maxBytes = options.maxBytes ?? MAX_BYTES;
    this.keep = Math.max(1, options.keep ?? KEEP_FILES);
    this.now = options.now ?? (() => new Date());
  }

  get file(): string {
    return path.join(this.dir, logFileName(this.name, 0));
  }

  write(source: string, message: string): void {
    if (this.broken) return;
    const lines = this.shareable(message)
      .map((line) => `${this.now().toISOString()} [${source}] ${line}\n`)
      .join('');
    if (lines === '') return;
    try {
      this.append(lines);
    } catch {
      this.broken = true;
    }
  }

  private shareable(message: string): string[] {
    const kept: string[] = [];
    for (const line of message.split('\n')) {
      if (line.trim() === '') continue;
      if (this.inPrivateKey) {
        if (KEY_END.test(line)) this.inPrivateKey = false;
        continue;
      }
      if (KEY_START.test(line) && !KEY_END.test(line)) this.inPrivateKey = true;
      kept.push(redactText(line));
    }
    return kept;
  }

  private append(text: string): void {
    const bytes = Buffer.byteLength(text);
    if (this.size === null) {
      mkdirSync(this.dir, { recursive: true });
      this.size = sizeOf(this.file);
    }
    if (this.size > 0 && this.size + bytes > this.maxBytes) this.rotate();
    appendFileSync(this.file, text, { mode: 0o600 });
    this.size += bytes;
  }

  private rotate(): void {
    const at = (index: number) => path.join(this.dir, logFileName(this.name, index));
    rmSync(at(this.keep - 1), { force: true });
    for (let index = this.keep - 2; index >= 0; index -= 1) {
      try {
        renameSync(at(index), at(index + 1));
      } catch {
        continue;
      }
    }
    this.size = 0;
  }
}
