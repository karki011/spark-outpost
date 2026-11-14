import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { claudeSessionMeta } from './agents.ts';

type Permissions = { blockReadsOutsideWorkingDirectories: boolean; deny: string[] };

const permissionsOf = (meta: Record<string, unknown>) =>
  (meta as { claudeCode: { options: { settings: { permissions: Permissions } } } }).claudeCode
    .options.settings.permissions;

let data: string;
let saved: string | undefined;

beforeEach(() => {
  saved = process.env.SPARK_DATA_DIR;
  data = realpathSync(mkdtempSync(join(tmpdir(), 'spark-reads-')));
  process.env.SPARK_DATA_DIR = data;
});

afterEach(() => {
  if (saved === undefined) delete process.env.SPARK_DATA_DIR;
  else process.env.SPARK_DATA_DIR = saved;
  rmSync(data, { recursive: true, force: true });
});

describe('where a Claude session may read', () => {
  it("lets a project chat read outside its folders, but not other chats' private folders", () => {
    const permissions = permissionsOf(claudeSessionMeta(['Read'], ['/work/app']));
    expect(permissions.blockReadsOutsideWorkingDirectories).toBe(false);
    expect(permissions.deny).toContain(`Read(/${data}/*/chats/**)`);
  });

  it('keeps a chat with no project inside its own private folder', () => {
    const own = join(data, 'dev', 'chats', 'c1', 'work');
    const permissions = permissionsOf(claudeSessionMeta(['Read'], [own]));
    expect(permissions.blockReadsOutsideWorkingDirectories).toBe(true);
    expect(permissions.deny).not.toContain(`Read(/${data}/*/chats/**)`);
  });
});
