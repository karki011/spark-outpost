import { Router } from 'express';
import {
  SLACK_CHANNEL_NOT_ALLOWED,
  allowSlackChannelsRequestSchema,
  allowSlackDmsRequestSchema,
  saveSlackConnectionRequestSchema,
  slackChannelIdSchema,
  slackConversationIdSchema,
  slackLinkRequestSchema,
  slackPresenceRequestSchema,
  startSlackRequestSchema,
  updateSlackSettingsRequestSchema,
  type SlackNotAllowed,
} from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import type { SecretStore } from '../setup/secrets.ts';
import type { ApiEndpoints } from '../setup/verify.ts';
import { allowOneSlackChannel, allowSlackChannels, listSlackChannels } from '../slack/channels.ts';
import {
  changeSlackSettings,
  refreshSlackScopes,
  removeSlack,
  saveSlack,
  slackStatus,
  type SlackDeps,
} from '../slack/connection.ts';
import { slackContextFromLink } from '../slack/context.ts';
import { allowOneSlackDm, allowSlackDms, listSlackDms } from '../slack/direct.ts';
import type { SlackNotifier } from '../slack/notifier.ts';
import { sendTestNotification } from '../slack/test-message.ts';
import type { SlackSocket } from '../slack/socket.ts';
import { SlackStartRefusedError, startFromSlack } from '../slack/start.ts';
import { requireSlackRef } from '../slack/thread.ts';
import {
  SlackApiError,
  SlackChannelNotAllowedError,
  SlackNotConnectedError,
} from '../slack/web-api.ts';
import { resolveRunTarget } from './run-target.ts';
import { BadRequestError, parseBody } from './validation.ts';

export interface SlackRouteDeps {
  db: Db;
  workspaceId: string;
  secrets: SecretStore;
  endpoints: ApiEndpoints;
  fixedRunProvider?: string;
  slackApiUrl?: string | undefined;
  slackNotifier?: Pick<SlackNotifier, 'setFocused'>;
  slackSocket?: Pick<SlackSocket, 'state' | 'refresh'>;
}

const USER_ERRORS = new Set([
  'invalid_auth',
  'not_authed',
  'token_revoked',
  'token_expired',
  'account_inactive',
  'not_bot_token',
  'team_mismatch',
  'bad_link',
  'direct_message',
  'direct_messages_off',
  'direct_messages_unavailable',
  'not_direct_message',
  'not_allowed_token_type',
  'user_not_found',
]);

export function slackErrorStatus(error: unknown): { status: number; message: string } | null {
  if (error instanceof SlackNotConnectedError || error instanceof SlackStartRefusedError) {
    return { status: 409, message: error.message };
  }
  if (error instanceof SlackChannelNotAllowedError) return { status: 409, message: error.message };
  if (error instanceof SlackApiError) {
    return { status: USER_ERRORS.has(error.code) ? 400 : 502, message: error.message };
  }
  return null;
}

function notAllowedBody(error: SlackChannelNotAllowedError): SlackNotAllowed {
  const { id, name, kind } = error.channel;
  return {
    error: error.message,
    code: SLACK_CHANNEL_NOT_ALLOWED,
    channel: { id, name, kind: kind ?? 'channel' },
  };
}

const pageCursor = (value: unknown): string | null =>
  typeof value === 'string' && value ? value.slice(0, 500) : null;

export function slackRoutes(routeDeps: SlackRouteDeps): Router {
  const deps: SlackDeps = {
    db: routeDeps.db,
    workspaceId: routeDeps.workspaceId,
    secrets: routeDeps.secrets,
    fetch: routeDeps.endpoints.fetch,
    slackApiUrl: routeDeps.slackApiUrl,
  };
  const socketState = () => routeDeps.slackSocket?.state() ?? 'off';
  const status = () => slackStatus(deps, socketState());
  const refreshed = async () => {
    await routeDeps.slackSocket?.refresh();
    return status();
  };
  const router = Router();

  router.get('/slack', async (_req, res) => {
    res.json(await status());
  });

  router.put('/slack/connection', async (req, res) => {
    await saveSlack(deps, parseBody(saveSlackConnectionRequestSchema, req));
    res.json(await refreshed());
  });

  router.delete('/slack/connection', async (_req, res) => {
    await removeSlack(deps);
    res.json(await refreshed());
  });

  router.patch('/slack/settings', async (req, res) => {
    await changeSlackSettings(deps, parseBody(updateSlackSettingsRequestSchema, req));
    res.json(await refreshed());
  });

  router.get('/slack/channels', async (req, res) => {
    res.json(await listSlackChannels(deps, pageCursor(req.query.cursor)));
  });

  router.put('/slack/channels', async (req, res) => {
    await allowSlackChannels(deps, parseBody(allowSlackChannelsRequestSchema, req));
    res.json(await status());
  });

  router.post('/slack/channels/:channelId/allow', async (req, res) => {
    const channelId = slackChannelIdSchema.safeParse(req.params.channelId);
    if (!channelId.success) throw new BadRequestError('Unknown Slack channel.');
    await allowOneSlackChannel(deps, channelId.data);
    res.json(await status());
  });

  router.get('/slack/direct-messages', async (req, res) => {
    res.json(await listSlackDms(deps, pageCursor(req.query.cursor)));
  });

  router.put('/slack/direct-messages', async (req, res) => {
    await allowSlackDms(deps, parseBody(allowSlackDmsRequestSchema, req));
    res.json(await status());
  });

  router.post('/slack/direct-messages/:channelId/allow', async (req, res) => {
    const channelId = slackConversationIdSchema.safeParse(req.params.channelId);
    if (!channelId.success) throw new BadRequestError('Unknown Slack conversation.');
    await allowOneSlackDm(deps, channelId.data);
    res.json(await status());
  });

  router.post('/slack/scopes/check', async (_req, res) => {
    await refreshSlackScopes(deps);
    res.json(await status());
  });

  router.post('/slack/test', async (_req, res) => {
    res.json(await sendTestNotification(deps));
  });

  router.post('/slack/presence', (req, res) => {
    const { focused } = parseBody(slackPresenceRequestSchema, req);
    routeDeps.slackNotifier?.setFocused(focused);
    res.status(204).end();
  });

  router.post('/slack/context', async (req, res) => {
    const { url } = parseBody(slackLinkRequestSchema, req);
    try {
      res.status(201).json(await slackContextFromLink(deps, url));
    } catch (error) {
      if (!(error instanceof SlackChannelNotAllowedError)) throw error;
      res.status(409).json(notAllowedBody(error));
    }
  });

  router.post('/slack/start', async (req, res) => {
    const request = parseBody(startSlackRequestSchema, req);
    const runTarget = (conversationId: string) => resolveRunTarget(routeDeps, conversationId);
    try {
      const started = await startFromSlack(
        { ...deps, runTarget },
        {
          source: 'link',
          ref: requireSlackRef(request.url),
          userId: null,
          conversationId: request.conversationId,
          messageId: request.messageId,
          projectId: request.projectId,
          mode: request.mode,
          note: request.note,
        },
      );
      res.status(201).json(started);
    } catch (error) {
      if (!(error instanceof SlackChannelNotAllowedError)) throw error;
      res.status(409).json(notAllowedBody(error));
    }
  });

  return router;
}
