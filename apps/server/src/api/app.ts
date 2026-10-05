import express, { type NextFunction, type Request, type Response } from 'express';
import { agentConfigRoutes } from './agent-config-routes.ts';
import { analyticsRoutes } from './analytics-routes.ts';
import type { AppEventFeed } from './app-events.ts';
import { approvalRoutes } from './approval-routes.ts';
import { attachmentRoutes } from './attachment-routes.ts';
import { auditRoutes } from './audit-routes.ts';
import { chatShareRoutes, type ChatShareRouteDeps } from './chat-share-routes.ts';
import { chatTicketRoutes, ticketMentionWarmer } from './chat-ticket-routes.ts';
import { chatSettingsRoutes, type ChatSettingsDeps } from './chat-settings-routes.ts';
import { chatWorkspaceRoutes, type ChatWorkspaceDeps } from './chat-workspace-routes.ts';
import { companionRoutes } from './companion-routes.ts';
import {
  conversationActionRoutes,
  type ConversationActionDeps,
} from './conversation-action-routes.ts';
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
import { previewRoutes } from './preview-routes.ts';
import { taskChangeRoutes } from './task-change-routes.ts';
import { taskRoutes } from './task-routes.ts';
import { queueRoutes } from './queue-routes.ts';
import { teammateRoutes } from './teammate-routes.ts';
import { slackRoutes, type SlackRouteDeps } from './slack-routes.ts';
import { ticketRoutes, type TicketRouteDeps } from './ticket-routes.ts';
import { webApp } from './web-app.ts';
import type { ActiveWork } from '../diagnostics/event-loop-lag.ts';
import { terminalRoutes } from '../terminal/routes.ts';
import type { TerminalSessions } from '../terminal/sessions.ts';
import type { PreviewServers } from '../preview/servers.ts';

export interface AppOptions
  extends
    RouteDeps,
    SetupDeps,
    ShipRouteDeps,
    TicketRouteDeps,
    Pick<SlackRouteDeps, 'slackApiUrl' | 'slackSignIn' | 'slackNotifier' | 'slackSocket'>,
    ChatSettingsDeps,
    Pick<ChatWorkspaceDeps, 'openFolder'>,
    Pick<OutcomeRouteDeps, 'outcomeSampleRate'>,
    Pick<McpRouteDeps, 'probeMcp'>,
    Pick<ConversationActionDeps, 'deleteSettleMs'>,
    Pick<ChatShareRouteDeps, 'linkScheme'> {
  terminals: TerminalSessions;
  previews: PreviewServers;
  appEvents: AppEventFeed;
  port: number;
  allowedOrigins: readonly string[];
  apiToken: string;
  webRoot?: string;
  diagnostics?: DiagnosticsPlaces;
  activeWork?: ActiveWork;
}

function trackRequests(work: ActiveWork) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.headers.accept?.includes('text/event-stream')) {
      res.once('close', work.begin(`${req.method} ${req.path}`));
    }
    next();
  };
}

export function createApp(options: AppOptions) {
  const app = express();
  app.disable('x-powered-by');
  if (options.activeWork) app.use(trackRequests(options.activeWork));
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
  app.use('/api', chatShareRoutes(options));
  app.use('/api', projectRoutes(options));
  app.use('/api', mapRoutes(options));
  app.use('/api', agentConfigRoutes(options));
  app.use('/api', mcpRoutes(options));
  app.use('/api', auditRoutes(options));
  app.use('/api', taskRoutes(options));
  app.use('/api', queueRoutes(options));
  app.use('/api', taskChangeRoutes(options));
  app.use('/api', shipRoutes(options));
  app.use('/api', prFollowUpRoutes(options));
  app.use('/api', ticketRoutes(options));
  app.use('/api', chatTicketRoutes(options));
  app.use('/api', slackRoutes(options));
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
  app.use('/api', previewRoutes(options));
  app.use(
    '/api',
    resetRoutes({
      ...options,
      stopTerminals: () => {
        options.terminals.killAll();
        void options.previews.stopAll('reset');
      },
    }),
  );
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
