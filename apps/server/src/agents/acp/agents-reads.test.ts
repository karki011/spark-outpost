import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { toGatePath } from '../../approvals/gate-path.ts';
import type { PathPolicy } from '../../projects/path-policy.ts';
import { agentDefinitions, claudeSessionMeta } from './agents.ts';
import { sessionMeta } from './session-start.ts';

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
    expect(permissions.deny).toContain(`Read(/${toGatePath(data)}/*/chats/**)`);
  });

  it('keeps a chat with no project inside its own private folder', () => {
    const own = join(data, 'dev', 'chats', 'c1', 'work');
    const permissions = permissionsOf(claudeSessionMeta(['Read'], [own]));
    expect(permissions.blockReadsOutsideWorkingDirectories).toBe(true);
    expect(permissions.deny).not.toContain(`Read(/${toGatePath(data)}/*/chats/**)`);
  });

  it('lets a chat with no project use its own folder when that folder is where the session starts', () => {
    const own = join(data, 'dev', 'chats', 'c1', 'work');
    const policy = { roots: [{ path: own, ignore: [] }] } as unknown as PathPolicy;
    for (const changing of [false, true]) {
      const meta = sessionMeta(agentDefinitions.claude, policy, changing, null, {});
      const permissions = permissionsOf(meta as Record<string, unknown>);
      expect(permissions.blockReadsOutsideWorkingDirectories).toBe(true);
      expect(permissions.deny.filter((rule) => rule.includes('/chats'))).toEqual([]);
    }
  });

  it("still keeps a project chat out of other chats' folders when the session starts in the project", () => {
    const policy = { roots: [{ path: '/work/app', ignore: [] }] } as unknown as PathPolicy;
    const meta = sessionMeta(agentDefinitions.claude, policy, true, null, {});
    const permissions = permissionsOf(meta as Record<string, unknown>);
    expect(permissions.deny).toContain(`Read(/${toGatePath(data)}/*/chats/**)`);
  });
});
