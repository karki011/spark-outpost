import { notifyAttention } from '../persistence/attention-items.ts';
import { saveSlackMentions, type SlackMention } from '../persistence/slack-mentions.ts';
import { openSlack, type OpenSlack, type SlackDeps } from './connection.ts';
import {
  isSlackDirectMatch,
  readableSlackDms,
  slackDmPlace,
  type SlackMatchChannel,
} from './direct.ts';
import { slackCall, slackText } from './web-api.ts';

export const MENTION_CHECK_MS = 60_000;
export const MENTION_CATCH_UP_MS = 24 * 60 * 60 * 1000;
const MENTIONS_PAGE = 50;
const SLACK_TS = /^\d{1,12}\.\d{1,9}$/;

export interface FoundMention extends SlackMention {
  text: string;
}

interface RawMention {
  channel?: SlackMatchChannel;
  user?: unknown;
  username?: unknown;
  text?: unknown;
  ts?: unknown;
  permalink?: unknown;
}

export function slackMentionQuery(memberId: string): string {
  return `<@${memberId}>`;
}

function mentions(text: string, memberId: string): boolean {
  return text.includes(`<@${memberId}>`) || text.includes(`<@${memberId}|`);
}

function httpsLink(value: string): string | null {
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

async function searchMentionPages(
  user: NonNullable<OpenSlack['user']>,
  memberId: string,
  since: number | null,
): Promise<RawMention[]> {
  const found: RawMention[] = [];
  for (let page = 1; ; page += 1) {
    const data = await slackCall(user, 'search.messages', {
      query: slackMentionQuery(memberId),
      sort: 'timestamp',
      sort_dir: 'desc',
      count: MENTIONS_PAGE,
      page,
    });
    const messages = data.messages as { matches?: unknown; paging?: { pages?: unknown } };
    const matches = (messages?.matches ?? []) as RawMention[];
    found.push(...matches);
    const oldest = Number(slackText(matches.at(-1)?.ts)) * 1000;
    const pages = typeof messages?.paging?.pages === 'number' ? messages.paging.pages : 1;
    if (since === null || matches.length === 0 || page >= pages || !(oldest >= since)) {
      return found;
    }
  }
}

export async function findSlackMentions(
  deps: SlackDeps,
  open: OpenSlack,
  since: number | null = null,
): Promise<FoundMention[] | null> {
  const memberId = open.connection.memberId;
  if (!open.user || !memberId) return null;
  const matches = await searchMentionPages(open.user, memberId, since);
  const dms = await readableSlackDms(deps, open);
  return matches.flatMap((match) => {
    const channelId = slackText(match.channel?.id);
    const ts = slackText(match.ts);
    const text = slackText(match.text);
    const permalink = httpsLink(slackText(match.permalink));
    if (!channelId || !SLACK_TS.test(ts) || !permalink) return [];
    if (slackText(match.user) === memberId || !mentions(text, memberId)) return [];
    const place = isSlackDirectMatch(match.channel)
      ? slackDmPlace(match.channel, dms)
      : `#${slackText(match.channel?.name) || channelId}`;
    if (!place) return [];
    return [
      {
        channelId,
        ts,
        authorName: slackText(match.username) || 'Someone',
        place,
        permalink,
        mentionedAt: new Date(Number(ts) * 1000),
        text,
      },
    ];
  });
}

function stoppableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('stopped'));
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('stopped'));
      },
      { once: true },
    );
  });
}

export interface SlackMentionWatchOptions {
  intervalMs?: number;
  now?: () => number;
  log?: (line: string) => void;
}

export interface SlackMentionWatch {
  check(): Promise<number>;
  stop(): Promise<void>;
}

export function startSlackMentionWatch(
  deps: SlackDeps,
  options: SlackMentionWatchOptions = {},
): SlackMentionWatch {
  const intervalMs = options.intervalMs ?? MENTION_CHECK_MS;
  const now = options.now ?? Date.now;
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;
  let running: Promise<number> = Promise.resolve(0);
  const stopping = new AbortController();
  const watchDeps: SlackDeps = {
    ...deps,
    sleep: (ms) => stoppableSleep(ms, stopping.signal),
  };

  async function checkOnce(): Promise<number> {
    if (stopped) return 0;
    const open = await openSlack(watchDeps);
    if (!open?.connection.settings.watchMentions) return 0;
    const { teamId, memberId, validatedAt } = open.connection;
    if (!memberId) return 0;
    const since = Math.max(validatedAt.getTime(), now() - MENTION_CATCH_UP_MS);
    const found = await findSlackMentions(watchDeps, open, since);
    if (!found) return 0;
    const fresh = found.filter((mention) => mention.mentionedAt.getTime() >= since);
    const owner = { teamId, memberId, validatedAt };
    const added = await saveSlackMentions(watchDeps.db, watchDeps.workspaceId, owner, fresh);
    if (added > 0) await notifyAttention(watchDeps.db, null);
    return added;
  }

  function check(): Promise<number> {
    running = running.then(checkOnce, checkOnce).catch((error: unknown) => {
      if (!stopped) options.log?.(`Slack mention check failed: ${(error as Error).message}`);
      return 0;
    });
    return running;
  }

  function schedule(): void {
    if (stopped) return;
    timer = setTimeout(() => {
      void check().finally(schedule);
    }, intervalMs);
    timer.unref?.();
  }

  schedule();
  return {
    check,
    async stop() {
      stopped = true;
      stopping.abort();
      if (timer) clearTimeout(timer);
      await running;
    },
  };
}
