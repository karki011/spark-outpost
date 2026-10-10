import type { BrowserHost } from '../browser/host-client.ts';
import type { CodeScanner } from '../codescan/scanner.ts';
import type { Db } from '../persistence/db.ts';
import type { ProtocolObserver } from '../providers/provider.ts';
import type { Append } from '../workflow/agent-turn.ts';
import type { ApprovalWaiters } from '../workflow/approval-waiters.ts';
import type { PublishScope } from '../ship/agent-push.ts';
import type { GitHubDeps } from '../ship/github/access.ts';
import type { SecretStore } from '../setup/secrets.ts';
import type { SlackDeps } from '../slack/connection.ts';
import type { SlackSignInConfig } from '../slack/sign-in-config.ts';
import type { TicketDeps } from '../tickets/connections.ts';
import type { InboxDeps } from '../tickets/inbox.ts';
import type { RunObservations } from '../observations/run-observations.ts';
import type { StackGit } from '../outposts/ports.ts';
import type { RequestWakes } from '../outposts/request-wait.ts';
import type { ParkedTurns } from '../workflow/parked-turns.ts';

export interface OutpostToolDeps {
  wakes: RequestWakes;
  parked?: Pick<ParkedTurns, 'park'>;
  stackGit?: StackGit;
}

export interface SparkToolDeps {
  db: Db;
  secrets: SecretStore;
  fetch: typeof fetch;
  linearApiUrl?: string | undefined;
  slackApiUrl?: string | undefined;
  slackSignIn?: SlackSignInConfig | null | undefined;
  github: Omit<GitHubDeps, 'db' | 'workspaceId' | 'secrets' | 'fetch'>;
  parallelBuilders?: boolean;
  codeScan?: Pick<CodeScanner, 'scan'>;
  branchPrefix?: string;
  linkScheme?: string | undefined;
  timeZone?: string;
  now?: () => Date;
  browser?: BrowserHost | undefined;
  shotDir?: string;
  outposts?: OutpostToolDeps | undefined;
}

export interface ReplySoFar {
  shown: string;
  held: number;
}

export interface SparkActionHooks {
  append: Append;
  waiters: ApprovalWaiters;
  signal: AbortSignal;
  timeoutMs: number;
  pollMs: number;
  audit?: ProtocolObserver | undefined;
  replySoFar?: () => ReplySoFar;
}

export interface SparkScope {
  workspaceId: string;
  conversationId: string | null;
  runId: string | null;
  readOnly?: boolean;
  actions?: SparkActionHooks;
  observations?: RunObservations | undefined;
  publish?: PublishScope | null | undefined;
  beforeToolCall?: () => Promise<void>;
}

export function ticketDepsFor(deps: SparkToolDeps, scope: SparkScope): TicketDeps {
  return {
    db: deps.db,
    workspaceId: scope.workspaceId,
    secrets: deps.secrets,
    fetch: deps.fetch,
    linearApiUrl: deps.linearApiUrl,
  };
}

export function slackDepsFor(deps: SparkToolDeps, scope: SparkScope): SlackDeps {
  return {
    db: deps.db,
    workspaceId: scope.workspaceId,
    secrets: deps.secrets,
    fetch: deps.fetch,
    slackApiUrl: deps.slackApiUrl,
    signIn: deps.slackSignIn,
  };
}

export function gitHubDepsFor(deps: SparkToolDeps, scope: SparkScope): GitHubDeps {
  return {
    ...deps.github,
    db: deps.db,
    workspaceId: scope.workspaceId,
    secrets: deps.secrets,
    fetch: deps.fetch,
  };
}

export function inboxDepsFor(deps: SparkToolDeps, scope: SparkScope): InboxDeps {
  return {
    ...ticketDepsFor(deps, scope),
    github: gitHubDepsFor(deps, scope),
    ...(deps.now ? { now: deps.now } : {}),
  };
}

export function localTimeZone(deps: SparkToolDeps): string {
  return deps.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
}

export function nowOf(deps: SparkToolDeps): Date {
  return deps.now?.() ?? new Date();
}
