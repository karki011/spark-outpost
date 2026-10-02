import express, { type NextFunction, type Request, type Response } from 'express';
import { agentConfigRoutes } from './agent-config-routes.ts';
import { analyticsRoutes } from './analytics-routes.ts';
import type { AppEventFeed } from './app-events.ts';
import { approvalRoutes } from './approval-routes.ts';
import { attachmentRoutes } from './attachment-routes.ts';
import { auditRoutes } from './audit-routes.ts';
import { chatTicketRoutes, ticketMentionWarmer } from './chat-ticket-routes.ts';
import { chatSettingsRoutes, type ChatSettingsDeps } from './chat-settings-routes.ts';
import { chatWorkspaceRoutes, type ChatWorkspaceDeps } from './chat-workspace-routes.ts';
import { companionRoutes } from './companion-routes.ts';
import { conversationActionRoutes } from './conversation-action-routes.ts';
import { diagnosticsRoutes, type DiagnosticsPlaces } from './diagnostics-routes.ts';
import { homeRoutes } from './home-routes.ts';
import { mapRoutes } from './map-routes.ts';
import { mcpRoutes, type McpRouteDeps } from './mcp-routes.ts';
import { modelCardRoutes } from './model-card-routes.ts';
import { outcomeRoutes, type OutcomeRouteDeps } from './outcome-routes.ts';
import { projectRoutes } from './project-routes.ts';
import { resetRoutes } from './reset-routes.ts';
import { apiRoutes, statusForError, type RouteDeps } from './routes.ts';
import { localRequestGuard, requireLaunchToken } from './security.ts';
import { setupRoutes, type SetupDeps } from './setup-routes.ts';
import { prFollowUpRoutes } from './pr-follow-up-routes.ts';
import { shipRoutes, type ShipRouteDeps } from './ship-routes.ts';
import { planRoutes } from './plan-routes.ts';
import { taskRoutes } from './task-routes.ts';
import { teammateRoutes } from './teammate-routes.ts';
import { ticketRoutes, type TicketRouteDeps } from './ticket-routes.ts';
import { webApp } from './web-app.ts';
import { terminalRoutes } from '../terminal/routes.ts';
import type { TerminalSessions } from '../terminal/sessions.ts';

export interface AppOptions
  extends
    RouteDeps,
    SetupDeps,
    ShipRouteDeps,
    TicketRouteDeps,
    ChatSettingsDeps,
    Pick<ChatWorkspaceDeps, 'openFolder'>,
    Pick<OutcomeRouteDeps, 'outcomeSampleRate'>,
    Pick<McpRouteDeps, 'probeMcp'> {
  terminals: TerminalSessions;
  appEvents: AppEventFeed;
  port: number;
  allowedOrigins: readonly string[];
  apiToken: string;
  webRoot?: string;
  diagnostics?: DiagnosticsPlaces;
}

export function createApp(options: AppOptions) {
  const app = express();
  app.disable('x-powered-by');
  app.use(localRequestGuard(options.port, options.allowedOrigins));
  app.use(requireLaunchToken(options.apiToken));
  app.use('/api', attachmentRoutes(options));
  app.use(express.json({ limit: '256kb' }));
  app.get('/api/events', (req, res) => options.appEvents.subscribe(req, res));
  app.use('/api', apiRoutes({ ...options, warmTicketMentions: ticketMentionWarmer(options) }));
  app.use('/api', setupRoutes(options));
  app.use('/api', chatSettingsRoutes(options));
  app.use('/api', chatWorkspaceRoutes(options));
  app.use('/api', conversationActionRoutes(options));
  app.use('/api', projectRoutes(options));
  app.use('/api', mapRoutes(options));
  app.use('/api', agentConfigRoutes(options));
  app.use('/api', mcpRoutes(options));
  app.use('/api', auditRoutes(options));
  app.use('/api', taskRoutes(options));
  app.use('/api', shipRoutes(options));
  app.use('/api', prFollowUpRoutes(options));
  app.use('/api', ticketRoutes(options));
  app.use('/api', chatTicketRoutes(options));
  app.use('/api', planRoutes(options));
  app.use('/api', approvalRoutes(options));
  app.use('/api', modelCardRoutes(options));
  app.use('/api', homeRoutes(options));
  app.use('/api', teammateRoutes(options));
  app.use('/api', companionRoutes(options));
  app.use('/api', outcomeRoutes(options));
  app.use('/api', analyticsRoutes(options));
  app.use('/api', diagnosticsRoutes(options));
  app.use('/api', terminalRoutes(options));
  app.use('/api', resetRoutes({ ...options, stopTerminals: () => options.terminals.killAll() }));
  if (options.webRoot) app.use(webApp(options.webRoot));
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found.' });
  });
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const { status, message } = statusForError(error);
    if (status === 500) console.error(error);
    if (res.headersSent) {
      res.end();
      return;
    }
    res.status(status).json({ error: message });
  });
  return app;
}
