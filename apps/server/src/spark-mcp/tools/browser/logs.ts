import { z } from 'zod';
import {
  BROWSER_LOG_ENTRIES_MAX,
  browserLogKindSchema,
  redactText,
  untrustedPage,
  type BrowserLogEntry,
  type BrowserLogsResult,
} from '@spark-outpost/contracts';
import { renderResult } from '../../format.ts';
import { SparkBlocks, sparkTool, type SparkToolContext } from '../../tool.ts';
import { allowedNote } from '../allowed-note.ts';
import { asToolError, browserSession, tabInput } from './context.ts';
import { viewNetwork, type NetworkQuery } from './network-view.ts';
import { clearPage, type Cleared } from './read-flow.ts';
import { pageScrub, type Scrub } from './scrub.ts';

const NETWORK_NOTE =
  'Sorted by start; +ms counts from the first request on this page, so overlapping times ran in parallel. Query values with secret-looking names show [redacted]. Headers and bodies are never recorded.';
const CONSOLE_NOTE =
  'Oldest first; +ms is on the same clock as the network log. Uncaught errors and unhandled rejections carry their stack.';

interface LogArgs extends NetworkQuery {
  tab?: string | undefined;
  kind: z.infer<typeof browserLogKindSchema>;
}

function consoleLine(entry: BrowserLogEntry): string {
  const when = entry.ms === null ? entry.at : `+${entry.ms}ms`;
  const status = entry.status === null ? '' : ` ${entry.status}`;
  const source = entry.source ? ` (${entry.source})` : '';
  const stack = entry.stack ? `\n  ${entry.stack.split('\n').join('\n  ')}` : '';
  return `${when} [${entry.level}]${status} ${entry.text}${source}${stack}`;
}

function levelsOf(type: string | undefined): Set<string> | null {
  const levels = (type ?? '')
    .toLowerCase()
    .split(/[\s,]+/)
    .map((level) => (level === 'warn' ? 'warning' : level))
    .filter((level) => level !== '');
  return levels.length === 0 ? null : new Set(levels);
}

function consoleView(found: BrowserLogsResult, args: LogArgs, hidden: Scrub) {
  const needle = args.filter?.toLowerCase();
  const levels = levelsOf(args.type);
  const since = args.since;
  const chosen = found.entries.filter(
    (entry) =>
      (levels === null || levels.has(entry.level)) &&
      (since === undefined || (entry.ms ?? 0) >= since),
  );
  const written = chosen.map((entry) => hidden(consoleLine(entry)));
  const kept = needle ? written.filter((line) => line.toLowerCase().includes(needle)) : written;
  const lines = kept.slice(-args.limit);
  const errors = chosen.filter((entry) => entry.level === 'error').length;
  return { lines, facts: { entries: lines.length, errors, note: CONSOLE_NOTE } };
}

function networkView(found: BrowserLogsResult, args: LogArgs, hidden: Scrub) {
  const scrubbed = found.requests.map((entry) => ({
    ...entry,
    url: hidden(entry.url),
    initiator: entry.initiator === null ? null : hidden(entry.initiator),
  }));
  const view = viewNetwork(scrubbed, args);
  return {
    lines: view.lines,
    facts: {
      entries: view.lines.length,
      matched: view.matched,
      recorded: found.requests.length,
      ...(view.hiddenPreflight > 0 ? { hiddenPreflight: view.hiddenPreflight } : {}),
      maxInFlight: view.maxInFlight,
      ...(view.pending > 0 ? { pending: view.pending } : {}),
      note: NETWORK_NOTE,
    },
  };
}

function rendered(
  found: BrowserLogsResult,
  cleared: Extract<Cleared, { cleared: true }>,
  args: LogArgs,
  hidden: Scrub,
) {
  const view =
    found.kind === 'network' ? networkView(found, args, hidden) : consoleView(found, args, hidden);
  const facts = {
    tab: found.tabId,
    url: hidden(found.url),
    kind: found.kind,
    ...view.facts,
    droppedOlder: found.dropped,
    ...allowedNote(cleared.decision),
  };
  return new SparkBlocks([
    { type: 'text', text: renderResult(facts) },
    { type: 'text', text: untrustedPage(hidden(found.url), redactText(view.lines.join('\n'))) },
  ]);
}

async function logs(args: LogArgs, context: SparkToolContext) {
  const session = browserSession(context);
  const hidden = await pageScrub(context);
  const found = await session.host
    .request(
      {
        op: 'logs',
        chatId: session.chatId,
        runId: session.runId,
        tab: args.tab,
        kind: args.kind,
        limit: BROWSER_LOG_ENTRIES_MAX,
      },
      context.signal,
    )
    .catch((error: unknown) => {
      throw asToolError(error);
    });
  const cleared = await clearPage(context, 'spark_browser_logs', 'logs', found);
  if (!cleared.cleared) return cleared.result;
  return rendered(found, cleared, args, hidden);
}

export const browserLogsTool = sparkTool({
  name: 'spark_browser_logs',
  needs: 'browser',
  title: 'Page logs',
  description:
    "A tab's console (errors with stacks, rejections, failed loads) or network requests since it loaded: method, full URL, status, type, initiator, start/end ms, sizes, cache, failure. OPTIONS preflights hidden unless method is OPTIONS or ANY. Untrusted page data.",
  input: {
    tab: tabInput,
    kind: browserLogKindSchema.default('console'),
    filter: z.string().max(200).optional().describe('Text (network: URL) to contain.'),
    method: z.string().max(10).optional(),
    status: z.string().max(9).optional().describe('404, 4xx or 400-599.'),
    type: z.string().max(40).optional().describe('Network: fetch, xhr…; console: error, warning…'),
    since: z.number().min(0).optional().describe('Start ms.'),
    limit: z.number().int().min(1).max(BROWSER_LOG_ENTRIES_MAX).default(50),
  },
  run: logs,
});
