import express, { type NextFunction, type Request, type Response } from 'express';
import { analyticsRoutes } from './analytics-routes.ts';
import type { AppEventFeed } from './app-events.ts';
import { approvalRoutes } from './approval-routes.ts';
import { attachmentRoutes } from './attachment-routes.ts';
import { auditRoutes } from './audit-routes.ts';
import { chatSettingsRoutes, type ChatSettingsDeps } from './chat-settings-routes.ts';
import { conversationActionRoutes } from './conversation-action-routes.ts';
import { homeRoutes } from './home-routes.ts';
import { modelCardRoutes } from './model-card-routes.ts';
import { outcomeRoutes, type OutcomeRouteDeps } from './outcome-routes.ts';
import { projectRoutes } from './project-routes.ts';
import { apiRoutes, statusForError, type RouteDeps } from './routes.ts';
import { localRequestGuard, requireLaunchToken } from './security.ts';
import { setupRoutes, type SetupDeps } from './setup-routes.ts';
import { shipRoutes, type ShipRouteDeps } from './ship-routes.ts';
import { planRoutes } from './plan-routes.ts';
import { taskRoutes } from './task-routes.ts';
import { webApp } from './web-app.ts';
import { terminalRoutes } from '../terminal/routes.ts';
import type { TerminalSessions } from '../terminal/sessions.ts';

export interface AppOptions
  extends
    RouteDeps,
    SetupDeps,
    ShipRouteDeps,
    ChatSettingsDeps,
    Pick<OutcomeRouteDeps, 'outcomeSampleRate'> {
  terminals: TerminalSessions;
  appEvents: AppEventFeed;
  port: number;
  allowedOrigins: readonly string[];
  apiToken: string;
  webRoot?: string;
}

export function createApp(options: AppOptions) {
  const app = express();
  app.disable('x-powered-by');
  app.use(localRequestGuard(options.port, options.allowedOrigins));
  app.use(requireLaunchToken(options.apiToken));
  app.use('/api', attachmentRoutes(options));
  app.use(express.json({ limit: '256kb' }));
  app.get('/api/events', (req, res) => options.appEvents.subscribe(req, res));
  app.use('/api', apiRoutes(options));
  app.use('/api', setupRoutes(options));
  app.use('/api', chatSettingsRoutes(options));
  app.use('/api', conversationActionRoutes(options));
  app.use('/api', projectRoutes(options));
  app.use('/api', auditRoutes(options));
  app.use('/api', taskRoutes(options));
  app.use('/api', shipRoutes(options));
  app.use('/api', planRoutes(options));
  app.use('/api', approvalRoutes(options));
  app.use('/api', modelCardRoutes(options));
  app.use('/api', homeRoutes(options));
  app.use('/api', outcomeRoutes(options));
  app.use('/api', analyticsRoutes(options));
  app.use('/api', terminalRoutes(options.terminals));
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
