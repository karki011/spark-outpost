import type { Dirent } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { isSecretPath } from '../projects/path-policy.ts';
import { isSensitiveEnvKey, redacted } from './redact.ts';

const MAX_FILE_BYTES = 64 * 1024;
const MIN_SENSITIVE_LENGTH = 6;
const MIN_OPAQUE_LENGTH = 16;

function worthHiding(key: string, value: string): boolean {
  if (/\s/.test(value)) return false;
  if (isSensitiveEnvKey(key)) return value.length >= MIN_SENSITIVE_LENGTH;
  return value.length >= MIN_OPAQUE_LENGTH && /\d/.test(value) && /[a-z]/i.test(value);
}

async function fileValues(file: string): Promise<string[]> {
  const content = await readFile(file, 'utf8').catch(() => '');
  if (content === '' || content.length > MAX_FILE_BYTES) return [];
  return Object.entries(parseEnv(content)).flatMap(([key, value]) =>
    value !== undefined && worthHiding(key, value) ? [value] : [],
  );
}

async function rootValues(root: string): Promise<string[]> {
  const entries: Dirent[] = await readdir(root, { withFileTypes: true }).catch(() => []);
  const secrets = entries.filter((entry) => entry.isFile() && isSecretPath(entry.name));
  const values = await Promise.all(secrets.map((entry) => fileValues(path.join(root, entry.name))));
  return values.flat();
}

export async function projectSecretValues(roots: readonly string[]): Promise<string[]> {
  const values = (await Promise.all(roots.map(rootValues))).flat();
  return [...new Set(values)].sort((a, b) => b.length - a.length);
}

export function withoutSecretValues<Value>(value: Value, secrets: readonly string[]): Value {
  if (secrets.length === 0) return value;
  const hidden = redacted('secret_value');
  const clean = (item: unknown): unknown => {
    if (typeof item === 'string') {
      return secrets.reduce((text, secret) => text.replaceAll(secret, hidden), item);
    }
    if (Array.isArray(item)) return item.map(clean);
    if (item === null || typeof item !== 'object') return item;
    return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, clean(child)]));
  };
  return clean(value) as Value;
}
