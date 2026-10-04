export const SLACK_API_URL = 'https://slack.com/api';

const REQUEST_TIMEOUT_MS = 20_000;
const RATE_LIMIT_WAIT_MAX_MS = 30_000;
const RATE_LIMIT_RETRIES = 2;

export class SlackApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SlackApiError';
  }
}

export class SlackNotConnectedError extends Error {
  constructor(message = "Slack isn't connected. Connect it in Settings → Connectors.") {
    super(message);
    this.name = 'SlackNotConnectedError';
  }
}

export class SlackChannelNotAllowedError extends Error {
  constructor(readonly channel: { id: string; name: string | null }) {
    super(
      `${channel.name ? `#${channel.name}` : 'That channel'} isn't in your allowed Slack channels. Allow it in Settings → Connectors → Slack.`,
    );
    this.name = 'SlackChannelNotAllowedError';
  }
}

export interface SlackClient {
  fetch: typeof fetch;
  apiUrl?: string | undefined;
  token: string;
  botName?: string | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
}

type Params = Record<string, string | number | boolean | undefined>;

const TOKEN_REJECTED = new Set([
  'invalid_auth',
  'not_authed',
  'token_revoked',
  'token_expired',
  'account_inactive',
]);

function messageFor(code: string, data: Record<string, unknown>, botName: string): string {
  if (TOKEN_REJECTED.has(code)) {
    return 'Slack rejected this token. Check that it was copied in full and the app is still installed.';
  }
  if (code === 'missing_scope') {
    const needed = typeof data.needed === 'string' ? ` (${data.needed.slice(0, 80)})` : '';
    return `The Slack app is missing a permission${needed}. Update the app from the manifest in Settings → Connectors → Slack and reinstall it.`;
  }
  if (code === 'not_in_channel' || code === 'channel_not_found') {
    return `The Spark app isn't in that channel. In Slack, type /invite @${botName} in the channel, then try again.`;
  }
  if (code === 'thread_not_found' || code === 'message_not_found') {
    return "Slack can't find that message. It may have been deleted.";
  }
  if (code === 'ratelimited') return 'Slack is rate limiting Spark. Try again in a minute.';
  if (code === 'not_allowed_token_type') return "That token type can't do this in Slack.";
  return `Slack answered with an error (${code.slice(0, 60)}).`;
}

function body(params: Params): URLSearchParams {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) form.set(key, String(value));
  }
  return form;
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function post(client: SlackClient, method: string, params: Params): Promise<Response> {
  try {
    return await client.fetch(`${client.apiUrl ?? SLACK_API_URL}/${method}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${client.token}`,
        'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
      },
      body: body(params),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new SlackApiError('unreachable', "Couldn't reach Slack. Check your connection.");
  }
}

function retryAfterMs(response: Response): number {
  const seconds = Number(response.headers.get('retry-after') ?? '1');
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 1000;
}

export async function slackCall(
  client: SlackClient,
  method: string,
  params: Params = {},
): Promise<Record<string, unknown>> {
  const botName = client.botName ?? 'Spark';
  for (let attempt = 0; ; attempt += 1) {
    const response = await post(client, method, params);
    if (response.status === 429) {
      const wait = retryAfterMs(response);
      if (attempt >= RATE_LIMIT_RETRIES || wait > RATE_LIMIT_WAIT_MAX_MS) {
        throw new SlackApiError('ratelimited', messageFor('ratelimited', {}, botName));
      }
      await (client.sleep ?? pause)(wait);
      continue;
    }
    const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!data || typeof data !== 'object') {
      throw new SlackApiError('bad_response', `Slack answered with ${response.status}.`);
    }
    if (data.ok === true) return data;
    const code = typeof data.error === 'string' ? data.error : 'unknown_error';
    throw new SlackApiError(code, messageFor(code, data, botName));
  }
}

export const slackText = (value: unknown): string => (typeof value === 'string' ? value : '');
