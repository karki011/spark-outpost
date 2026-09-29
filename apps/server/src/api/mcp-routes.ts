import { Router, type Request } from 'express';
import {
  mcpEnableRequestSchema,
  saveUserMcpRequestSchema,
  type ChatMcpServer,
  type UserMcpList,
} from '@spark-outpost/contracts';
import { repoScanner, type RepoScanner } from '../agent-config/discovery.ts';
import { conversationProjectIds, enabledProjectMcp } from '../agent-config/store.ts';
import { effectiveFor, userServerView } from '../mcp/effective.ts';
import { launchOf, resolveUserServer } from '../mcp/launch.ts';
import { probeMcpServer, type ProbeResult } from '../mcp/probe.ts';
import { deleteMcpSecrets } from '../mcp/secrets.ts';
import {
  GLOBAL_KEY,
  deleteUserMcp,
  enablementsFor,
  getUserMcp,
  listUserMcp,
  recordCheck,
  setUserEnablement,
  type UserMcpRow,
} from '../mcp/store.ts';
import { saveManualServer } from '../mcp/save.ts';
import type { McpServerConfig } from '../agent-config/mcp-json.ts';
import type { Db } from '../persistence/db.ts';
import { getProject } from '../projects/projects.ts';
import type { SecretStore } from '../setup/secrets.ts';
import { AgentConfigConflictError } from './agent-config-routes.ts';
import { BadRequestError, paramId, parseBody } from './validation.ts';

export interface McpRouteDeps {
  db: Db;
  workspaceId: string;
  secrets: SecretStore;
  probeMcp?: (server: McpServerConfig) => Promise<ProbeResult>;
  scanner?: RepoScanner;
}

export function mcpRoutes({
  db,
  workspaceId,
  secrets,
  probeMcp = probeMcpServer,
  scanner = repoScanner,
}: McpRouteDeps): Router {
  const router = Router();

  const list = async (): Promise<UserMcpList> => {
    const servers = await listUserMcp(db, workspaceId);
    const rows = await enablementsFor(
      db,
      servers.map((server) => server.id),
    );
    return { servers: servers.map((server) => userServerView(server, rows)) };
  };

  const serverOf = async (req: Request): Promise<UserMcpRow> => {
    const server = await getUserMcp(db, workspaceId, paramId(req));
    if (!server) throw new BadRequestError('That MCP server no longer exists.');
    return server;
  };

  router.get('/mcp/servers', async (_req, res) => {
    res.json(await list());
  });

  router.post('/mcp/servers', async (req, res) => {
    const body = parseBody(saveUserMcpRequestSchema, req);
    await saveManualServer({ db, workspaceId, secrets }, null, body);
    res.status(201).json(await list());
  });

  router.put('/mcp/servers/:id', async (req, res) => {
    const server = await serverOf(req);
    if (server.source !== 'user') {
      throw new BadRequestError(
        'Servers imported from another app cannot be edited. Remove it and add it again yourself.',
      );
    }
    const body = parseBody(saveUserMcpRequestSchema, req);
    await saveManualServer({ db, workspaceId, secrets }, server, body);
    res.json(await list());
  });

  router.delete('/mcp/servers/:id', async (req, res) => {
    const server = await serverOf(req);
    await deleteUserMcp(db, workspaceId, server.id);
    await deleteMcpSecrets(secrets, server.id);
    res.json(await list());
  });

  router.put('/mcp/servers/:id/enable', async (req, res) => {
    const server = await serverOf(req);
    const body = parseBody(mcpEnableRequestSchema, req);
    if (body.enabled === true && body.fingerprint !== server.fingerprint) {
      throw new AgentConfigConflictError(
        'This MCP server changed since you reviewed it. Review it again before turning it on.',
      );
    }
    if (body.scope === 'project') await getProject(db, workspaceId, body.scopeId!);
    const scopeKey = body.scope === 'global' ? GLOBAL_KEY : body.scopeId!;
    await setUserEnablement(db, workspaceId, server, {
      scope: body.scope,
      scopeKey,
      enabled: body.enabled,
    });
    res.json(await list());
  });

  router.post('/mcp/servers/:id/test', async (req, res) => {
    const server = await serverOf(req);
    const result = await probeMcp(await resolveUserServer(launchOf(server), secrets));
    await recordCheck(db, server.id, {
      ...result,
      checkedAt: new Date().toISOString(),
      fingerprint: server.fingerprint,
    });
    res.json(await list());
  });

  router.get('/conversations/:id/mcp', async (req, res) => {
    const chatId = paramId(req);
    const projectIds = await conversationProjectIds(db, chatId);
    const users = await listUserMcp(db, workspaceId);
    const rows = await enablementsFor(
      db,
      users.map((server) => server.id),
    );
    const servers: ChatMcpServer[] = users.map((server) => ({
      kind: 'user',
      id: server.id,
      name: server.name,
      source: server.source,
      transport: server.transport,
      fingerprint: server.fingerprint,
      ...effectiveFor(server, rows, chatId, projectIds),
      check: server.check,
    }));
    const approved = await enabledProjectMcp(db, projectIds);
    for (const projectId of projectIds) {
      const project = await getProject(db, workspaceId, projectId).catch(() => null);
      const scan = project ? await scanner.scan(project.rootPath).catch(() => null) : null;
      if (!project || !scan) continue;
      const enabled = approved.get(projectId) ?? new Map<string, string>();
      for (const server of scan.mcpServers) {
        const reviewed = enabled.get(server.name);
        servers.push({
          kind: 'project',
          projectId,
          projectName: project.name,
          name: server.name,
          transport: server.transport,
          enabled: reviewed === server.fingerprint,
          changed: reviewed !== undefined && reviewed !== server.fingerprint,
        });
      }
    }
    res.json({ servers });
  });

  return router;
}
