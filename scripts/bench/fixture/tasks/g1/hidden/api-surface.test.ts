import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('the project lint passes', () => {
  const lint = spawnSync(process.execPath, ['scripts/check-api.ts'], { encoding: 'utf8' });
  assert.equal(lint.status, 0, lint.stderr);
});

test('clampCents is recorded as public API', () => {
  const surface = JSON.parse(readFileSync('api-surface.json', 'utf8')) as Record<string, string[]>;
  assert.ok(surface['src/money.ts']?.includes('clampCents'));
});
