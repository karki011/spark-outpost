import { z } from 'zod';
import {
  slackChannelPageSchema,
  slackContextResponseSchema,
  slackNotAllowedSchema,
  slackStatusSchema,
  slackTestResponseSchema,
  startSlackResponseSchema,
  type AllowSlackChannelsRequest,
  type SaveSlackConnectionRequest,
  type SlackChannelPage,
  type SlackContextResponse,
  type SlackNotAllowed,
  type SlackStatus,
  type StartSlackRequest,
  type StartSlackResponse,
  type UpdateSlackSettingsRequest,
} from '@spark-outpost/contracts';
import { ApiError, request } from '../api/client.ts';

export const slackKeys = {
  status: ['slack', 'status'] as const,
  channels: ['slack', 'channels'] as const,
};

const json = (method: string, body: unknown = {}): RequestInit => ({
  method,
  body: JSON.stringify(body),
});

export const slackApi = {
  status: (): Promise<SlackStatus> => request(slackStatusSchema, '/slack'),
  connect: (body: SaveSlackConnectionRequest): Promise<SlackStatus> =>
    request(slackStatusSchema, '/slack/connection', json('PUT', body)),
  disconnect: (): Promise<SlackStatus> =>
    request(slackStatusSchema, '/slack/connection', { method: 'DELETE' }),
  updateSettings: (body: UpdateSlackSettingsRequest): Promise<SlackStatus> =>
    request(slackStatusSchema, '/slack/settings', json('PATCH', body)),
  channels: (cursor: string | null): Promise<SlackChannelPage> =>
    request(
      slackChannelPageSchema,
      `/slack/channels${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
    ),
  allowChannels: (body: AllowSlackChannelsRequest): Promise<SlackStatus> =>
    request(slackStatusSchema, '/slack/channels', json('PUT', body)),
  allowChannel: (channelId: string): Promise<SlackStatus> =>
    request(slackStatusSchema, `/slack/channels/${channelId}/allow`, json('POST')),
  test: (): Promise<{ sentTo: string }> =>
    request(slackTestResponseSchema, '/slack/test', json('POST')),
  presence: (focused: boolean): Promise<null> =>
    request(z.null(), '/slack/presence', json('POST', { focused })),
  context: (url: string, signal?: AbortSignal): Promise<SlackContextResponse> =>
    request(slackContextResponseSchema, '/slack/context', {
      ...json('POST', { url }),
      ...(signal ? { signal } : {}),
    }),
  start: (
    body: Partial<StartSlackRequest> &
      Pick<StartSlackRequest, 'url' | 'conversationId' | 'messageId'>,
  ): Promise<StartSlackResponse> =>
    request(startSlackResponseSchema, '/slack/start', json('POST', body)),
};

export function slackNotAllowed(error: unknown): SlackNotAllowed | null {
  if (!(error instanceof ApiError)) return null;
  const parsed = slackNotAllowedSchema.safeParse(error.body);
  return parsed.success ? parsed.data : null;
}
