import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Project, RepoAgentConfig } from '@spark-outpost/contracts';
import { createRepoScanner } from '../src/agent-config/discovery.ts';
import { loadRepoLaunch } from '../src/agent-config/launch.ts';
import { createConversation } from '../src/persistence/conversations.ts';
import { removeProject } from '../src/projects/project-removal.ts';
import { createTestApp, LOCAL_HEADERS, ORIGIN } from './app-support.ts';
import { makeConfiguredRepo } from './repo-config-fixture.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let app: ReturnType<typeof createTestApp>;
let base: string;
let root: string;

beforeAll(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'spark-agent-config-db-')));
  root = join(base, 'app');
  await mkdir(root);
  await makeConfiguredRepo(root);
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

beforeEach(async () => {
  t = await createTestDb();
  app = createTestApp(t);
});

afterEach(async () => {
  await t.cleanup();
});

const get = (path: string) => request(app).get(path).set(LOCAL_HEADERS);
const send = (method: 'post' | 'patch' | 'put', path: string, body: object) =>
  request(app)[method](path).set(LOCAL_HEADERS).set('Origin', ORIGIN).send(body);

async function linked(folder = root): Promise<Project> {
  const response = await send('post', '/api/projects', { rootPath: folder }).expect(201);
  return response.body as Project;
}

async function config(projectId: string): Promise<RepoAgentConfig> {
  return (await get(`/api/projects/${projectId}/agent-config`).expect(200)).body as RepoAgentConfig;
}

async function audits(projectId: string) {
  const { rows } = await t.db.query<{ subject: string; target: string | null; enabled: boolean }>(
    `SELECT subject, target, enabled FROM agent_config_audit
      WHERE project_id = $1 ORDER BY created_at, subject`,
    [projectId],
  );
  return rows;
}

describe('project agent setup API', () => {
  it('reports what the repo has, with instructions, skills and subagents on and risky parts off', async () => {
    const project = await linked();
    const view = await config(project.id);
    expect(view.settings).toEqual({
      instructions: true,
      skills: true,
      commands: true,
      subagents: true,
      hooks: false,
      hooksChanged: false,
    });
    expect(view.skills.map((skill) => skill.name)).toEqual(['lint', 'zebra']);
    expect(view.hooks).toHaveLength(4);
    expect(view.mcpServers.map((server) => [server.name, server.enabled])).toEqual([
      ['echo', false],
      ['remote', false],
      ['stream', false],
    ]);
    expect(view.mcpServers[0]).toMatchObject({ envNames: ['API_TOKEN', 'ECHO_MODE'] });
    expect(JSON.stringify(view)).not.toContain('loud');
  });

  it('saves switches per project and audits each change', async () => {
    const project = await linked();
    const other = await linked(await makeOther('other'));
    const response = await send('patch', `/api/projects/${project.id}/agent-config`, {
      skills: false,
      commands: false,
    }).expect(200);
    expect((response.body as RepoAgentConfig).settings).toMatchObject({
      skills: false,
      commands: false,
      instructions: true,
    });
    expect((await config(other.id)).settings.skills).toBe(true);
    expect(await audits(project.id)).toEqual([
      { subject: 'commands', target: null, enabled: false },
      { subject: 'skills', target: null, enabled: false },
    ]);
  });

  it('turns hooks on only for the exact set the user reviewed', async () => {
    const project = await linked();
    const path = `/api/projects/${project.id}/agent-config`;
    await send('patch', path, { hooks: true }).expect(400);
    await send('patch', path, { hooks: true, hooksFingerprint: 'stale' }).expect(409);
    const { hooksFingerprint } = await config(project.id);
    await send('patch', path, { hooks: true, hooksFingerprint }).expect(200);
    expect((await config(project.id)).settings.hooks).toBe(true);
    const { rows } = await t.db.query<{ detail: { commands: string[] } }>(
      `SELECT detail FROM agent_config_audit WHERE subject = 'hooks' AND enabled`,
    );
    expect(rows[0]!.detail.commands).toHaveLength(4);
    await writeFile(join(root, '.claude/settings.local.json'), JSON.stringify({ hooks: {} }));
    try {
      const changed = await config(project.id);
      expect(changed.settings).toMatchObject({ hooks: false, hooksChanged: true });
    } finally {
      await makeConfiguredRepo(root);
    }
    await send('patch', path, { hooks: false }).expect(200);
    expect((await audits(project.id)).map((row) => [row.subject, row.enabled])).toEqual([
      ['hooks', true],
      ['hooks', false],
    ]);
  });

  it('enables an MCP server per project against its reviewed fingerprint and audits it', async () => {
    const project = await linked();
    const echo = (await config(project.id)).mcpServers[0]!;
    const path = `/api/projects/${project.id}/agent-config/mcp/echo`;
    await send('put', path, { enabled: true }).expect(400);
    await send('put', path, { enabled: true, fingerprint: 'stale' }).expect(409);
    await send('put', `/api/projects/${project.id}/agent-config/mcp/ghost`, {
      enabled: false,
    }).expect(400);
    await send('put', path, { enabled: true, fingerprint: echo.fingerprint }).expect(200);
    const view = await config(project.id);
    expect(view.mcpServers.map((server) => [server.name, server.enabled])).toEqual([
      ['echo', true],
      ['remote', false],
      ['stream', false],
    ]);
    const { rows } = await t.db.query<{ source: string; config: object }>(
      'SELECT source, config FROM mcp_servers',
    );
    expect(rows).toEqual([
      {
        source: 'project',
        config: {
          command: 'node',
          args: ['server.js', '--root', '${HOME}'],
          url: null,
          envNames: ['API_TOKEN', 'ECHO_MODE'],
          headerNames: [],
        },
      },
    ]);
    await send('put', path, { enabled: false }).expect(200);
    expect((await config(project.id)).mcpServers[0]!.enabled).toBe(false);
    expect(await audits(project.id)).toEqual([
      { subject: 'mcp', target: 'echo', enabled: true },
      { subject: 'mcp', target: 'echo', enabled: false },
    ]);
  });

  it('drops a project’s settings and servers with the project', async () => {
    const project = await linked();
    const echo = (await config(project.id)).mcpServers[0]!;
    await send('patch', `/api/projects/${project.id}/agent-config`, { skills: false });
    await send('put', `/api/projects/${project.id}/agent-config/mcp/echo`, {
      enabled: true,
      fingerprint: echo.fingerprint,
    });
    await removeProject(t.db, t.workspaceId, project.id);
    for (const table of ['project_agent_settings', 'mcp_servers', 'mcp_server_enablements']) {
      const { rows } = await t.db.query(`SELECT 1 FROM ${table}`);
      expect(rows).toEqual([]);
    }
  });
});

describe('agent launch reads the project switches', () => {
  it('follows the chat’s projects in order, including a Builder worktree in place of the first', async () => {
    const project = await linked();
    const echo = (await config(project.id)).mcpServers[0]!;
    await send('patch', `/api/projects/${project.id}/agent-config`, { instructions: false });
    await send('put', `/api/projects/${project.id}/agent-config/mcp/echo`, {
      enabled: true,
      fingerprint: echo.fingerprint,
    });
    const conversationId = randomUUID();
    await createConversation(t.db, t.workspaceId, conversationId);
    await t.db.query(
      'INSERT INTO conversation_projects (conversation_id, project_id, position) VALUES ($1, $2, 0)',
      [conversationId, project.id],
    );
    const worktree = join(base, 'worktree');
    await mkdir(worktree, { recursive: true });
    await makeConfiguredRepo(worktree);
    for (const folder of [root, worktree]) {
      const [launch] = await loadRepoLaunch(t.db, createRepoScanner(), conversationId, [folder]);
      expect(launch).toMatchObject({ root: folder, instructions: null, hooks: null });
      expect(launch!.skills?.map((skill) => skill.name)).toEqual(['lint', 'zebra']);
      expect(launch!.mcpServers.map((server) => server.name)).toEqual(['echo']);
    }
  });
});

async function makeOther(name: string): Promise<string> {
  const folder = join(base, name);
  await mkdir(folder, { recursive: true });
  await makeConfiguredRepo(folder);
  return folder;
}
