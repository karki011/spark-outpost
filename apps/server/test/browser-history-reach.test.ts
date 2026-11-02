import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SOURCE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [full] : [];
  });
}

function relative(file: string): string {
  return path.relative(SOURCE, file).split(path.sep).join('/');
}

describe('browser history reach', () => {
  const files = sourceFiles(SOURCE).map((file) => ({
    name: relative(file),
    text: readFileSync(file, 'utf8'),
  }));

  it('is read only by its own routes, never by a Spark tool, prompt or audit', () => {
    const importers = files
      .filter((file) => file.text.includes('persistence/browser-history.ts'))
      .map((file) => file.name);
    expect(importers).toEqual(['api/browser-history-routes.ts']);
  });

  it('is queried only by its store', () => {
    const queries = files
      .filter((file) => file.text.includes('browser_history'))
      .map((file) => file.name);
    expect(queries).toEqual(['persistence/browser-history.ts']);
  });
});
