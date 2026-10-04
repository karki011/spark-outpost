import { WebSocket } from 'ws';
import { SLACK_START_CALLBACK, type SlackSocketState } from '@spark-outpost/contracts';
import { newId } from '../persistence/ids.ts';
import { setSlackProblem } from '../persistence/slack.ts';
import { clientFor, openSlack } from './connection.ts';
import {
  SlackStartRefusedError,
  startFromSlack,
  type SlackStartDeps,
  type SlackStartRequest,
} from './start.ts';
import { SlackChannelNotAllowedError, slackCall, slackText } from './web-api.ts';

const RETRY_MIN_MS = 5_000;
const RETRY_MAX_MS = 60_000;

export interface SlackSocket {
  state(): SlackSocketState;
  refresh(): Promise<void>;
  stop(): void;
}

type Trigger = Pick<SlackStartRequest, 'source' | 'ref' | 'userId'>;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function slackTrigger(envelope: Record<string, unknown>): Trigger | null {
  const payload = record(envelope.payload);
  if (envelope.type === 'events_api') {
    const event = record(payload.event);
    if (event.type !== 'app_mention' || typeof event.bot_id === 'string') return null;
    const ts = slackText(event.ts);
    const channelId = slackText(event.channel);
    if (!ts || !channelId) return null;
    return {
      source: 'mention',
      userId: slackText(event.user) || null,
      ref: { channelId, ts, threadTs: slackText(event.thread_ts) || null },
    };
  }
  if (envelope.type !== 'interactive') return null;
  if (payload.type !== 'message_action' || payload.callback_id !== SLACK_START_CALLBACK) {
    return null;
  }
  const message = record(payload.message);
  const ts = slackText(message.ts);
  const channelId = slackText(record(payload.channel).id);
  if (!ts || !channelId) return null;
  return {
    source: 'shortcut',
    userId: slackText(record(payload.user).id) || null,
    ref: { channelId, ts, threadTs: slackText(message.thread_ts) || null },
  };
}

export function startSlackSocket(
  deps: SlackStartDeps,
  options: { retryMs?: number } = {},
): SlackSocket {
  let state: SlackSocketState = 'off';
  let socket: WebSocket | null = null;
  let retry: NodeJS.Timeout | null = null;
  let retryMs = options.retryMs ?? RETRY_MIN_MS;
  let stopped = false;
  let token: string | null = null;

  const close = () => {
    if (retry) clearTimeout(retry);
    retry = null;
    const current = socket;
    socket = null;
    current?.removeAllListeners();
    current?.on('error', () => undefined);
    current?.close();
  };

  const later = () => {
    if (stopped || retry) return;
    retry = setTimeout(() => {
      retry = null;
      void connect();
    }, retryMs);
    retry.unref();
    retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
  };

  async function handle(trigger: Trigger): Promise<void> {
    if (!trigger.userId) return;
    try {
      await startFromSlack(deps, {
        ...trigger,
        conversationId: newId(),
        messageId: newId(),
        mode: 'build',
        note: '',
      });
    } catch (error) {
      if (error instanceof SlackStartRefusedError || error instanceof SlackChannelNotAllowedError) {
        return;
      }
      const message = (error as Error).message;
      console.error('Could not start work from Slack', message);
      await setSlackProblem(
        deps.db,
        deps.workspaceId,
        `Couldn't start work from Slack: ${message}`,
      ).catch(() => undefined);
    }
  }

  function onMessage(current: WebSocket, raw: string): void {
    let envelope: Record<string, unknown>;
    try {
      envelope = record(JSON.parse(raw));
    } catch {
      return;
    }
    if (envelope.type === 'hello') {
      state = 'connected';
      retryMs = options.retryMs ?? RETRY_MIN_MS;
      return;
    }
    if (envelope.type === 'disconnect') {
      close();
      void connect();
      return;
    }
    if (typeof envelope.envelope_id === 'string') {
      current.send(JSON.stringify({ envelope_id: envelope.envelope_id }));
    }
    const trigger = slackTrigger(envelope);
    if (trigger) void handle(trigger);
  }

  async function connect(): Promise<void> {
    if (stopped || !token) return;
    state = 'connecting';
    try {
      const data = await slackCall(clientFor(deps, token), 'apps.connections.open');
      if (stopped || !token) return;
      const current = new WebSocket(slackText(data.url));
      socket = current;
      current.on('message', (raw) => onMessage(current, raw.toString()));
      const lost = () => {
        if (socket !== current) return;
        close();
        state = 'failed';
        later();
      };
      current.on('close', lost);
      current.on('error', lost);
    } catch (error) {
      state = 'failed';
      console.error('Slack Socket Mode could not connect', (error as Error).message);
      later();
    }
  }

  return {
    state: () => state,
    async refresh() {
      const open = await openSlack(deps).catch(() => null);
      const wanted =
        open?.tokens.app && open.connection.settings.startFromSlack ? open.tokens.app : null;
      if (wanted === token && (wanted === null || state !== 'off')) return;
      close();
      token = wanted;
      state = 'off';
      if (token) await connect();
    },
    stop() {
      stopped = true;
      close();
      state = 'off';
    },
  };
}
