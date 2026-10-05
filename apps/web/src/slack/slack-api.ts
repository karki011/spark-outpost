import { z } from 'zod';
import {
  slackChannelPageSchema,
  slackContextResponseSchema,
  slackDmPageSchema,
  slackNotAllowedSchema,
  slackSignInFlowSchema,
  slackStatusSchema,
  slackTestResponseSchema,
  startSlackResponseSchema,
  type AllowSlackChannelsRequest,
  type AllowSlackDmsRequest,
  type SaveSlackConnectionRequest,
  type SlackChannelPage,
  type SlackContextResponse,
  type SlackDmPage,
  type SlackNotAllowed,
  type SlackSignInFlow,
  type SlackStatus,
  type StartSlackRequest,
  type StartSlackResponse,
  type UpdateSlackSettingsRequest,
} from '@spark-outpost/contracts';
import { ApiError, request } from '../api/client.ts';

export const slackKeys = {
  status: ['slack', 'status'] as const,
  signIn: ['slack', 'sign-in'] as const,
  channels: ['slack', 'channels'] as const,
  directMessages: ['slack', 'direct-messages'] as const,
};

const json = (method: string, body: unknown = {}): RequestInit => ({
  method,
  body: JSON.stringify(body),
});

const paged = (path: string, cursor: string | null): string =>
  cursor ? `${path}?cursor=${encodeURIComponent(cursor)}` : path;

export const slackApi = {
  status: (): Promise<SlackStatus> => request(slackStatusSchema, '/slack'),
  signIn: (): Promise<SlackSignInFlow> => request(slackSignInFlowSchema, '/slack/sign-in'),
  startSignIn: (body: { directMessages: boolean; replace: boolean }): Promise<SlackSignInFlow> =>
    request(slackSignInFlowSchema, '/slack/sign-in', json('POST', body)),
  cancelSignIn: (): Promise<SlackSignInFlow> =>
    request(slackSignInFlowSchema, '/slack/sign-in', { method: 'DELETE' }),
  connect: (body: SaveSlackConnectionRequest & { replace?: boolean }): Promise<SlackStatus> =>
    request(slackStatusSchema, '/slack/connection', json('PUT', body)),
  disconnect: (): Promise<SlackStatus> =>
    request(slackStatusSchema, '/slack/connection', { method: 'DELETE' }),
  updateSettings: (body: UpdateSlackSettingsRequest): Promise<SlackStatus> =>
    request(slackStatusSchema, '/slack/settings', json('PATCH', body)),
  channels: (cursor: string | null): Promise<SlackChannelPage> =>
    request(slackChannelPageSchema, paged('/slack/channels', cursor)),
  allowChannels: (body: AllowSlackChannelsRequest): Promise<SlackStatus> =>
    request(slackStatusSchema, '/slack/channels', json('PUT', body)),
  allowChannel: (channelId: string): Promise<SlackStatus> =>
    request(slackStatusSchema, `/slack/channels/${channelId}/allow`, json('POST')),
  directMessages: (cursor: string | null): Promise<SlackDmPage> =>
    request(slackDmPageSchema, paged('/slack/direct-messages', cursor)),
  allowDirectMessages: (body: AllowSlackDmsRequest): Promise<SlackStatus> =>
    request(slackStatusSchema, '/slack/direct-messages', json('PUT', body)),
  allowDirectMessage: (channelId: string): Promise<SlackStatus> =>
    request(slackStatusSchema, `/slack/direct-messages/${channelId}/allow`, json('POST')),
  checkScopes: (): Promise<SlackStatus> =>
    request(slackStatusSchema, '/slack/scopes/check', json('POST')),
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

export function allowSlackPlace(place: SlackNotAllowed['channel']): Promise<SlackStatus> {
  return place.kind === 'channel'
    ? slackApi.allowChannel(place.id)
    : slackApi.allowDirectMessage(place.id);
}

export const allowSlackPlaceLabel = (place: SlackNotAllowed['channel']): string =>
  place.kind === 'channel' ? 'Allow this channel' : 'Allow this conversation';

export function slackNotAllowed(error: unknown): SlackNotAllowed | null {
  if (!(error instanceof ApiError)) return null;
  const parsed = slackNotAllowedSchema.safeParse(error.body);
  return parsed.success ? parsed.data : null;
}
