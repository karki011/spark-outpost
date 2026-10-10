import { Router, type Request } from 'express';
import {
  type AgentTerminal,
  type AgentTerminalList,
  type CommandOutputResponse,
  type CreateShellResponse,
} from '@spark-outpost/contracts';
import { paramId } from '../api/validation.ts';
import { askAgentTerminalStop } from '../persistence/agent-terminal-changes.ts';
import {
  agentTerminalOutput,
  agentTerminalRow,
  chatAgentTerminals,
  toAgentTerminal,
  type AgentTerminalRow,
} from '../persistence/agent-terminals.ts';
import type { Db } from '../persistence/db.ts';
import type { AgentTerminals } from './agent-terminals.ts';
import type { TerminalSessions } from './sessions.ts';
import { shellFolder } from './shell-folder.ts';

export interface AgentTerminalRouteDeps {
  db: Db;
  workspaceId: string;
  terminals: TerminalSessions;
  agentTerminals: AgentTerminals;
}

const NOT_FOUND = { error: 'Agent terminal not found.' };
const NOT_RUNNING = { error: 'This agent terminal is not running any more.' };

export function agentTerminalRoutes({
  db,
  workspaceId,
  terminals,
  agentTerminals,
}: AgentTerminalRouteDeps): Router {
  const router = Router();

  const chatTerminal = async (req: Request): Promise<AgentTerminalRow | null> => {
    const conversationId = paramId(req);
    const row = await agentTerminalRow(db, paramId(req, 'terminalId'));
    const owned = row?.workspaceId === workspaceId && row.conversationId === conversationId;
    return row && owned ? row : null;
  };

  router.get('/conversations/:id/agent-terminals', async (req, res) => {
    const rows = await chatAgentTerminals(db, paramId(req));
    const response: AgentTerminalList = {
      terminals: rows.filter((row) => row.workspaceId === workspaceId).map(toAgentTerminal),
    };
    res.json(response);
  });

  router.get('/conversations/:id/agent-terminals/:terminalId/output', async (req, res) => {
    const row = await chatTerminal(req);
    const output = row ? await agentTerminalOutput(db, row.conversationId, row.id) : null;
    if (!output) {
      res.status(404).json(NOT_FOUND);
      return;
    }
    const response: CommandOutputResponse = output;
    res.json(response);
  });

  router.post('/conversations/:id/agent-terminals/:terminalId/view', async (req, res) => {
    const row = await chatTerminal(req);
    if (!row) {
      res.status(404).json(NOT_FOUND);
      return;
    }
    if (!agentTerminals.running(row.id)) {
      res.status(409).json(NOT_RUNNING);
      return;
    }
    const folder = await shellFolder(db, workspaceId, row.conversationId);
    const created = terminals.createView((viewer, size) =>
      agentTerminals.view(row.id, viewer, size),
    );
    const response: CreateShellResponse = {
      ...created,
      cwd: row.cwd,
      label: row.name,
      kind: folder.cwd === row.cwd ? folder.kind : 'project',
      note: null,
    };
    res.status(201).json(response);
  });

  router.post('/conversations/:id/agent-terminals/:terminalId/stop', async (req, res) => {
    const row = await chatTerminal(req);
    const asked = row ? await askAgentTerminalStop(db, row.id, 'user') : null;
    if (!asked) {
      res.status(404).json(NOT_FOUND);
      return;
    }
    await agentTerminals.sync();
    const response: AgentTerminal = toAgentTerminal(
      (await agentTerminalRow(db, asked.id)) ?? asked,
    );
    res.json(response);
  });

  return router;
}
