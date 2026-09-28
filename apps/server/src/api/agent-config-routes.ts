import { Router } from 'express';
import {
  AGENT_CONFIG_SWITCHES,
  updateAgentConfigRequestSchema,
  updateMcpServerRequestSchema,
  updateRedirectsRequestSchema,
  updateTrustRequestSchema,
  type RepoAgentConfig,
} from '@spark-outpost/contracts';
import { repoScanner, type RepoScan, type RepoScanner } from '../agent-config/discovery.ts';
import {
  agentSettingsFor,
  enabledProjectMcp,
  setProjectMcpServer,
  updateAgentSettings,
} from '../agent-config/store.ts';
import {
  grantTrust,
  listProjectTrust,
  setRedirects,
  trustFor,
  withdrawTrust,
} from '../agent-config/trust-store.ts';
import { agentConfigView } from '../agent-config/view.ts';
import type { Db } from '../persistence/db.ts';
import { getProject } from '../projects/projects.ts';
import { BadRequestError, paramId, parseBody } from './validation.ts';

export class AgentConfigConflictError extends Error {}

export interface AgentConfigRouteDeps {
  db: Db;
  workspaceId: string;
  scanner?: RepoScanner;
}

interface Loaded {
  scan: RepoScan;
  view: RepoAgentConfig;
}

export function agentConfigRoutes({
  db,
  workspaceId,
  scanner = repoScanner,
}: AgentConfigRouteDeps): Router {
  const router = Router();

  const load = async (projectId: string): Promise<Loaded> => {
    const project = await getProject(db, workspaceId, projectId);
    const [scan, settings, mcp, trust] = await Promise.all([
      scanner.scan(project.rootPath),
      agentSettingsFor(db, [project.id]),
      enabledProjectMcp(db, [project.id]),
      trustFor(db, [project.id]),
    ]);
    const view = agentConfigView(
      project,
      scan,
      settings.get(project.id)!,
      mcp.get(project.id) ?? new Map(),
      trust.get(project.id) ?? null,
    );
    return { scan, view };
  };

  router.get('/projects/:id/agent-config', async (req, res) => {
    res.json((await load(paramId(req))).view);
  });

  router.patch('/projects/:id/agent-config', async (req, res) => {
    const projectId = paramId(req);
    const body = parseBody(updateAgentConfigRequestSchema, req);
    const { scan } = await load(projectId);
    if (body.hooks === true && body.hooksFingerprint !== scan.hooksFingerprint) {
      throw new AgentConfigConflictError(
        'The hooks changed since you reviewed them. Review the list again before turning them on.',
      );
    }
    const { hooks } = body;
    const switches = Object.fromEntries(
      AGENT_CONFIG_SWITCHES.flatMap((name) =>
        body[name] === undefined ? [] : [[name, body[name]]],
      ),
    );
    await updateAgentSettings(db, workspaceId, projectId, {
      switches,
      ...(hooks === undefined
        ? {}
        : {
            hooks: {
              enabled: hooks,
              fingerprint: hooks ? scan.hooksFingerprint : null,
              commands: scan.hooks.map((hook) => `${hook.event}: ${hook.command}`),
            },
          }),
    });
    res.json((await load(projectId)).view);
  });

  router.put('/projects/:id/agent-config/mcp/:name', async (req, res) => {
    const projectId = paramId(req);
    const body = parseBody(updateMcpServerRequestSchema, req);
    const { scan } = await load(projectId);
    const server = scan.mcpServers.find((candidate) => candidate.name === req.params.name);
    if (!server) throw new BadRequestError('That MCP server is no longer in .mcp.json.');
    if (body.enabled && body.fingerprint !== server.fingerprint) {
      throw new AgentConfigConflictError(
        'This MCP server changed since you reviewed it. Review it again before turning it on.',
      );
    }
    await setProjectMcpServer(db, workspaceId, projectId, server, body.enabled);
    res.json((await load(projectId)).view);
  });

  router.get('/agent-config/trust', async (_req, res) => {
    res.json(await listProjectTrust(db, workspaceId));
  });

  router.put('/projects/:id/agent-config/trust', async (req, res) => {
    const projectId = paramId(req);
    const body = parseBody(updateTrustRequestSchema, req);
    const { scan, view } = await load(projectId);
    if (!body.trusted) {
      await withdrawTrust(db, workspaceId, projectId);
    } else if (body.fingerprint !== view.trust.fingerprint) {
      throw new AgentConfigConflictError(
        'The folder’s hooks, allow rules or MCP servers changed since you reviewed them. Review them again.',
      );
    } else {
      await grantTrust(db, workspaceId, projectId, scan);
    }
    res.json((await load(projectId)).view);
  });

  router.put('/projects/:id/agent-config/trust/redirects', async (req, res) => {
    const projectId = paramId(req);
    const body = parseBody(updateRedirectsRequestSchema, req);
    const { scan, view } = await load(projectId);
    if (body.confirmed) {
      if (view.trust.state !== 'trusted') {
        throw new BadRequestError('Trust this folder before using its key or proxy settings.');
      }
      if (body.fingerprint !== view.trust.redirectsFingerprint) {
        throw new AgentConfigConflictError(
          'These settings changed since you reviewed them. Review them again.',
        );
      }
    }
    await setRedirects(db, workspaceId, projectId, scan, body.confirmed);
    res.json((await load(projectId)).view);
  });

  return router;
}
