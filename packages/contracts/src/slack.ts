import { z } from 'zod';
import { attachmentSchema } from './attachments.ts';
import { ticketStartModeSchema } from './tickets.ts';

export const SLACK_START_CALLBACK = 'spark_start_work';
export const SLACK_THREAD_TEXT_MAX = 12_000;
export const SLACK_THREAD_MESSAGES_MAX = 100;
export const SLACK_POST_TEXT_MAX = 3_000;
export const SLACK_ALLOWED_CHANNELS_MAX = 100;
export const SLACK_ALLOWED_USERS_MAX = 20;
export const SLACK_START_NOTE_MAX = 2_000;

export const SLACK_BOT_SCOPES = {
  'chat:write': 'Send your notifications and post the updates you confirm.',
  'channels:read': 'List public channels so you can pick the ones Spark may use.',
  'groups:read': 'List the private channels the app was invited to.',
  'channels:history': 'Read a thread you share from a public channel the app is in.',
  'groups:history': 'Read a thread you share from a private channel the app is in.',
  'users:read': 'Show who wrote each message by name and check your member ID.',
  'app_mentions:read': 'Hear @Spark mentions that start work (Socket Mode only).',
  commands: 'Offer the "Start work in Spark" message shortcut (Socket Mode only).',
} as const;

export const SLACK_USER_SCOPES = {
  'search:read': 'Search messages for an agent, limited afterwards to channels you allowed.',
  'channels:history': 'Read threads in public channels the app has not joined.',
  'groups:history': 'Read threads in your private channels the app has not joined.',
  'channels:read': 'List every public channel you can see in the channel picker.',
  'groups:read': 'List your private channels in the channel picker.',
} as const;

export const SLACK_APP_SCOPES = {
  'connections:write': 'Open the Socket Mode connection, so Slack needs no public URL.',
} as const;

export const SLACK_APP_MANIFEST = {
  display_information: {
    name: 'Spark Outpost',
    description: 'Notifications, shared threads and updates for Spark Outpost on your Mac.',
    background_color: '#1f2430',
  },
  features: {
    app_home: {
      home_tab_enabled: false,
      messages_tab_enabled: true,
      messages_tab_read_only_enabled: true,
    },
    bot_user: { display_name: 'Spark', always_online: false },
    shortcuts: [
      {
        name: 'Start work in Spark',
        type: 'message',
        callback_id: SLACK_START_CALLBACK,
        description: 'Start a Spark chat from this message or thread.',
      },
    ],
  },
  oauth_config: {
    scopes: {
      bot: Object.keys(SLACK_BOT_SCOPES),
      user: Object.keys(SLACK_USER_SCOPES),
    },
  },
  settings: {
    event_subscriptions: { bot_events: ['app_mention'] },
    interactivity: { is_enabled: true },
    org_deploy_enabled: false,
    socket_mode_enabled: true,
    token_rotation_enabled: false,
  },
} as const;

export const slackManifestJson = (): string => JSON.stringify(SLACK_APP_MANIFEST, null, 2);

const token = (prefix: string, name: string) =>
  z
    .string()
    .trim()
    .max(400)
    .regex(new RegExp(`^${prefix}-[A-Za-z0-9-]{8,}$`), `A ${name} starts with ${prefix}-.`);

const optionalToken = (prefix: string, name: string) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    token(prefix, name).optional(),
  );

export const saveSlackConnectionRequestSchema = z.object({
  botToken: token('xoxb', 'bot token'),
  userToken: optionalToken('xoxp', 'user token'),
  appToken: optionalToken('xapp', 'app-level token'),
});
export type SaveSlackConnectionRequest = z.infer<typeof saveSlackConnectionRequestSchema>;

export const slackChannelIdSchema = z.string().regex(/^[CG][A-Z0-9]{2,20}$/);
export const slackUserIdSchema = z.string().regex(/^[UW][A-Z0-9]{2,20}$/);

export const slackChannelSchema = z.object({
  id: slackChannelIdSchema,
  name: z.string().min(1).max(120),
  isPrivate: z.boolean(),
  isMember: z.boolean(),
});
export type SlackChannel = z.infer<typeof slackChannelSchema>;

export const slackAllowedChannelSchema = slackChannelSchema.omit({ isMember: true }).extend({
  projectId: z.uuid().nullable(),
});
export type SlackAllowedChannel = z.infer<typeof slackAllowedChannelSchema>;

export const slackChannelPageSchema = z.object({
  channels: z.array(slackChannelSchema),
  nextCursor: z.string().nullable(),
});
export type SlackChannelPage = z.infer<typeof slackChannelPageSchema>;

export const slackNotifyEventSchema = z.enum([
  'needs_you',
  'finished',
  'failed',
  'pr_opened',
  'flag',
]);
export type SlackNotifyEvent = z.infer<typeof slackNotifyEventSchema>;

export const slackNotifyLabels: Record<SlackNotifyEvent, { label: string; hint: string }> = {
  needs_you: {
    label: 'A chat needs you',
    hint: 'An approval, a plan to review or a question is waiting.',
  },
  finished: { label: 'A chat finished', hint: 'The agent finished its turn.' },
  failed: { label: 'A chat failed', hint: 'The run stopped with an error.' },
  pr_opened: { label: 'A pull request opened', hint: 'Includes the pull request link.' },
  flag: { label: 'A guardrail flag', hint: 'An agent action crossed a hard rail.' },
};

export const slackSettingsSchema = z.object({
  notify: z
    .object({
      needs_you: z.boolean().default(true),
      finished: z.boolean().default(true),
      failed: z.boolean().default(true),
      pr_opened: z.boolean().default(true),
      flag: z.boolean().default(false),
    })
    .prefault({}),
  quietWhenFocused: z.boolean().default(true),
  notifyChannelId: slackChannelIdSchema.nullable().default(null),
  defaultChannelId: slackChannelIdSchema.nullable().default(null),
  startFromSlack: z.boolean().default(true),
  postUpdatesToThread: z.boolean().default(true),
  allowedUserIds: z.array(slackUserIdSchema).max(SLACK_ALLOWED_USERS_MAX).default([]),
});
export type SlackSettings = z.infer<typeof slackSettingsSchema>;

export const updateSlackSettingsRequestSchema = z
  .object({
    notify: slackSettingsSchema.shape.notify.unwrap().partial(),
    quietWhenFocused: z.boolean(),
    notifyChannelId: slackChannelIdSchema.nullable(),
    defaultChannelId: slackChannelIdSchema.nullable(),
    startFromSlack: z.boolean(),
    postUpdatesToThread: z.boolean(),
    allowedUserIds: z.array(slackUserIdSchema).max(SLACK_ALLOWED_USERS_MAX),
    memberId: slackUserIdSchema.nullable(),
  })
  .partial()
  .strict();
export type UpdateSlackSettingsRequest = z.infer<typeof updateSlackSettingsRequestSchema>;

export const allowSlackChannelsRequestSchema = z.object({
  channels: z
    .array(
      z.object({
        id: slackChannelIdSchema,
        projectId: z.uuid().nullable().default(null),
      }),
    )
    .max(SLACK_ALLOWED_CHANNELS_MAX),
});
export type AllowSlackChannelsRequest = z.infer<typeof allowSlackChannelsRequestSchema>;

export const slackSocketStateSchema = z.enum(['off', 'connecting', 'connected', 'failed']);
export type SlackSocketState = z.infer<typeof slackSocketStateSchema>;

export const slackCapabilitiesSchema = z.object({
  notify: z.boolean(),
  readThreads: z.boolean(),
  readUnjoined: z.boolean(),
  search: z.boolean(),
  post: z.boolean(),
  startFromSlack: z.boolean(),
});
export type SlackCapabilities = z.infer<typeof slackCapabilitiesSchema>;

export const slackConnectionSchema = z.object({
  team: z.string(),
  teamUrl: z.string(),
  botName: z.string(),
  member: z.object({ id: slackUserIdSchema, name: z.string() }).nullable(),
  tokens: z.object({ bot: z.boolean(), user: z.boolean(), app: z.boolean() }),
  capabilities: slackCapabilitiesSchema,
  validatedAt: z.string(),
  settings: slackSettingsSchema,
  allowedChannels: z.array(slackAllowedChannelSchema),
  socket: slackSocketStateSchema,
  lastProblem: z.object({ message: z.string(), at: z.string() }).nullable(),
});
export type SlackConnection = z.infer<typeof slackConnectionSchema>;

export const slackStatusSchema = z.object({ connection: slackConnectionSchema.nullable() });
export type SlackStatus = z.infer<typeof slackStatusSchema>;

export const slackTestResponseSchema = z.object({ sentTo: z.string() });

export const slackPresenceRequestSchema = z.object({ focused: z.boolean() });

export const slackLinkRequestSchema = z.object({ url: z.string().trim().min(1).max(2000) });

export const slackThreadPreviewSchema = z.object({
  channel: z.object({ id: slackChannelIdSchema, name: z.string() }),
  author: z.string(),
  postedAt: z.string().nullable(),
  firstLine: z.string(),
  messages: z.number().int().nonnegative(),
  truncated: z.boolean(),
  permalink: z.string(),
});
export type SlackThreadPreview = z.infer<typeof slackThreadPreviewSchema>;

export const slackContextResponseSchema = z.object({
  attachment: attachmentSchema,
  preview: slackThreadPreviewSchema,
});
export type SlackContextResponse = z.infer<typeof slackContextResponseSchema>;

export const SLACK_CHANNEL_NOT_ALLOWED = 'slack_channel_not_allowed';

export const slackNotAllowedSchema = z.object({
  error: z.string(),
  code: z.literal(SLACK_CHANNEL_NOT_ALLOWED),
  channel: z.object({ id: slackChannelIdSchema, name: z.string().nullable() }),
});
export type SlackNotAllowed = z.infer<typeof slackNotAllowedSchema>;

export const startSlackRequestSchema = z.object({
  url: z.string().trim().min(1).max(2000),
  conversationId: z.uuid(),
  messageId: z.uuid(),
  projectId: z.uuid().optional(),
  mode: ticketStartModeSchema.default('build'),
  note: z.string().trim().max(SLACK_START_NOTE_MAX).default(''),
});
export type StartSlackRequest = z.infer<typeof startSlackRequestSchema>;

export const startSlackResponseSchema = z.object({
  conversationId: z.uuid(),
  runId: z.uuid(),
  preview: slackThreadPreviewSchema,
});
export type StartSlackResponse = z.infer<typeof startSlackResponseSchema>;

export interface SlackMessageRef {
  channelId: string;
  ts: string;
  threadTs: string | null;
}

const SLACK_MESSAGE_URL =
  /^https:\/\/[a-z0-9-]+(?:\.enterprise)?\.slack\.com\/archives\/([A-Z][A-Z0-9]{2,20})\/p(\d{10})(\d{6})\/?(?:\?([^#\s]*))?(?:#\S*)?$/;
const THREAD_TS = /(?:^|&)thread_ts=(\d{10}\.\d{6})(?:&|$)/;

export function parseSlackMessageUrl(raw: string): SlackMessageRef | null {
  const match = SLACK_MESSAGE_URL.exec(raw.trim());
  if (!match) return null;
  return {
    channelId: match[1]!,
    ts: `${match[2]}.${match[3]}`,
    threadTs: THREAD_TS.exec(match[4] ?? '')?.[1] ?? null,
  };
}

export const isSlackMessageUrl = (raw: string): boolean => parseSlackMessageUrl(raw) !== null;

export function escapeSlackText(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export const SPARK_URL_SCHEME = 'spark-outpost';

export function sparkChatLink(conversationId: string, scheme: string = SPARK_URL_SCHEME): string {
  return `${scheme}://chat/${conversationId}`;
}

const CHAT_ID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

export function parseSparkChatLink(raw: string, scheme: string = SPARK_URL_SCHEME): string | null {
  if (!/^[a-z][a-z0-9-]*$/.test(scheme)) return null;
  return new RegExp(`^${scheme}://chat/(${CHAT_ID})$`).exec(raw)?.[1] ?? null;
}
