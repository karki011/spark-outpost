import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configuredChecks } from './detect.ts';
import { checkScriptChanged, scriptsFingerprint } from './project-checks.ts';

let root: string;

const scripts = (entries: Record<string, string>) =>
  writeFile(join(root, 'package.json'), JSON.stringify({ scripts: entries }));

const check = (command: string) => configuredChecks([command])[0]!;

const START = { test: 'pnpm run build && vitest run', build: 'tsc -b', lint: 'eslint .' };

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'spark-scripts-'));
  await scripts(START);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('whether the script a check runs changed', () => {
  it('runs the check when other scripts were added or changed', async () => {
    const before = await scriptsFingerprint(root);
    await scripts({ ...START, lint: 'eslint . --fix', storybook: 'storybook dev' });
    expect(await checkScriptChanged(check('pnpm run test'), before, root)).toBe(false);
    expect(await checkScriptChanged(check('npm test'), before, root)).toBe(false);
    expect(await checkScriptChanged(check('pnpm run lint'), before, root)).toBe(true);
    expect(await checkScriptChanged(check('pnpm lint'), before, root)).toBe(true);
  });

  it('holds the check when its script, a hook of it or a script it runs changed', async () => {
    const before = await scriptsFingerprint(root);
    await scripts({ ...START, build: 'tsc -b && node upload.mjs' });
    expect(await checkScriptChanged(check('pnpm run test'), before, root)).toBe(true);
    await scripts({ ...START, pretest: 'node prepare.mjs' });
    expect(await checkScriptChanged(check('pnpm run test'), before, root)).toBe(true);
    await scripts({ ...START, test: 'vitest run' });
    expect(await checkScriptChanged(check('pnpm run test'), before, root)).toBe(true);
  });

  it('never holds a command that runs no package script', async () => {
    const before = await scriptsFingerprint(root);
    await scripts({ test: 'exit 0' });
    expect(await checkScriptChanged(check('pnpm exec vitest run'), before, root)).toBe(false);
    expect(await checkScriptChanged(check('cargo test --quiet'), before, root)).toBe(false);
  });
});
