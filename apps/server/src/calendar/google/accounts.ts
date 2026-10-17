import type { GoogleAccountState, HelperCalendar } from '@spark-outpost/contracts';
import { withTransaction, type Db } from '../../persistence/db.ts';
import { googleCalendarSecret, type SecretStore } from '../../setup/secrets.ts';
import { rematchCalendars } from '../rematch.ts';
import { lockChoices, replaceChoices, savedChoices } from '../store.ts';
import { GoogleApiError, listGoogleCalendars, type GoogleApiDeps } from './api.ts';
import type { GoogleClientConfig } from './config.ts';
import { mapGoogleCalendar } from './map.ts';
import { GoogleAuthError, refreshGoogleAccess } from './oauth.ts';
import { markGoogleSignIn, type GoogleAccountRow } from './store.ts';
import {
  fullSync,
  googleWindow,
  syncCalendar,
  type CalendarSync,
  type GoogleWindow,
} from './sync.ts';

export const GOOGLE_POLL_MS = 3 * 60_000;
export const GOOGLE_BACKOFF_START_MS = 30_000;
export const GOOGLE_BACKOFF_MAX_MS = 30 * 60_000;
const TOKEN_MARGIN_MS = 60_000;

export const SIGN_IN_AGAIN = 'Google sign-in ran out. Sign in again to keep this account.';

export interface AccountDeps {
  db: Db;
  workspaceId: string;
  secrets: SecretStore;
  fetch: typeof fetch;
  client: GoogleClientConfig;
  now: () => number;
}

export interface LiveAccount {
  row: GoogleAccountRow;
  accessToken: string | null;
  expiresAt: number;
  calendars: Map<string, CalendarSync>;
  state: GoogleAccountState;
  message: string | null;
  failures: number;
  synced: boolean;
}

export function liveAccount(row: GoogleAccountRow): LiveAccount {
  return {
    row,
    accessToken: null,
    expiresAt: 0,
    calendars: new Map(),
    state: row.needsSignIn ? 'sign_in_again' : 'syncing',
    message: row.needsSignIn ? SIGN_IN_AGAIN : null,
    failures: 0,
    synced: false,
  };
}

export class SignInAgain extends Error {}

async function accessToken(deps: AccountDeps, account: LiveAccount): Promise<string> {
  if (account.accessToken && account.expiresAt - TOKEN_MARGIN_MS > deps.now()) {
    return account.accessToken;
  }
  const refreshToken = await deps.secrets.get(googleCalendarSecret(account.row.subject));
  if (!refreshToken) throw new SignInAgain();
  const answer = await refreshGoogleAccess(deps, refreshToken, deps.now());
  if (answer.kind === 'rejected') throw new SignInAgain();
  account.accessToken = answer.accessToken;
  account.expiresAt = answer.expiresAt;
  return answer.accessToken;
}

async function saveCalendars(
  deps: AccountDeps,
  accountId: string,
  calendars: readonly HelperCalendar[],
) {
  const owner = { googleAccountId: accountId };
  return withTransaction(deps.db, async (client) => {
    await lockChoices(client, deps.workspaceId, owner);
    const match = rematchCalendars(await savedChoices(client, deps.workspaceId, owner), calendars);
    if (match.changed) await replaceChoices(client, deps.workspaceId, match.writes, owner);
    return { choices: await savedChoices(client, deps.workspaceId, owner), changed: match.changed };
  });
}

function prefixOf(accountId: string) {
  return `google:${accountId}:`;
}

export function isSkippable(error: unknown): boolean {
  return error instanceof GoogleApiError && ['forbidden', 'not_found'].includes(error.kind);
}

export async function withFreshToken<T>(
  deps: AccountDeps,
  account: LiveAccount,
  work: (api: GoogleApiDeps) => Promise<T>,
): Promise<T> {
  const api = async (): Promise<GoogleApiDeps> => ({
    fetch: deps.fetch,
    apiUrl: deps.client.apiUrl,
    accessToken: await accessToken(deps, account),
  });
  try {
    return await work(await api());
  } catch (error) {
    if (!(error instanceof GoogleApiError) || error.kind !== 'unauthorized') throw error;
    account.accessToken = null;
    return work(await api());
  }
}

const RANGE_CONCURRENCY = 4;

async function settleAll<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = [];
  for (let index = 0; index < items.length; index += limit) {
    results.push(...(await Promise.allSettled(items.slice(index, index + limit).map(work))));
  }
  return results;
}

async function pollWith(deps: AccountDeps, account: LiveAccount, api: GoogleApiDeps) {
  const entries = await listGoogleCalendars(api);
  const mapped = entries.flatMap((entry) => {
    const calendar = mapGoogleCalendar(account.row.id, account.row.email, entry);
    return calendar ? [calendar] : [];
  });
  const saved = await saveCalendars(deps, account.row.id, mapped);
  const window = googleWindow(deps.now());
  const prefix = prefixOf(account.row.id);
  const wanted = saved.choices
    .filter((choice) => choice.include && choice.calendarId.startsWith(prefix))
    .map((choice) => choice.calendarId.slice(prefix.length));
  let changed = saved.changed;
  const next = new Map<string, CalendarSync>();
  for (const calendarId of wanted) {
    const previous = account.calendars.get(calendarId) ?? null;
    try {
      const result = await syncCalendar(
        api,
        { accountId: account.row.id, calendarId },
        previous,
        window,
      );
      next.set(calendarId, result.sync);
      changed ||= result.changed;
    } catch (error) {
      if (!isSkippable(error)) throw error;
      changed ||= previous !== null;
    }
  }
  changed ||= [...account.calendars.keys()].some((calendarId) => !next.has(calendarId));
  account.calendars = next;
  return changed;
}

export async function accountRange(
  deps: AccountDeps,
  account: LiveAccount,
  range: GoogleWindow,
): Promise<Map<string, CalendarSync>> {
  return withFreshToken(deps, account, async (api) => {
    const calendarIds = [...account.calendars.keys()];
    const results = await settleAll(calendarIds, RANGE_CONCURRENCY, (calendarId) =>
      fullSync(api, { accountId: account.row.id, calendarId }, range),
    );
    const found = new Map<string, CalendarSync>();
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') found.set(calendarIds[index]!, result.value);
      else if (!isSkippable(result.reason)) throw result.reason;
    });
    return found;
  });
}

export function backoffMs(failures: number, retryAfterMs: number | null, random: number): number {
  const base = Math.min(GOOGLE_BACKOFF_MAX_MS, GOOGLE_BACKOFF_START_MS * 2 ** (failures - 1));
  const jittered = Math.round(base * (0.8 + random * 0.4));
  return Math.max(jittered, retryAfterMs ?? 0);
}

export interface PollOutcome {
  changed: boolean;
  nextInMs: number | null;
}

function failureMessage(error: unknown): string {
  if (error instanceof GoogleApiError && error.kind === 'rate_limited') {
    return 'Google asked Spark to slow down. Trying again soon.';
  }
  if (error instanceof GoogleApiError || error instanceof GoogleAuthError) {
    return `${error.message} Trying again soon.`;
  }
  return 'Couldn’t read this Google account. Trying again soon.';
}

async function signInAgain(deps: AccountDeps, account: LiveAccount): Promise<PollOutcome> {
  account.accessToken = null;
  account.synced = false;
  account.state = 'sign_in_again';
  account.message = SIGN_IN_AGAIN;
  await markGoogleSignIn(deps.db, deps.workspaceId, account.row.id, true);
  account.row = { ...account.row, needsSignIn: true };
  return { changed: true, nextInMs: null };
}

export async function pollAccount(
  deps: AccountDeps,
  account: LiveAccount,
  random: () => number = Math.random,
): Promise<PollOutcome> {
  if (account.row.needsSignIn) return { changed: false, nextInMs: null };
  try {
    const changed = await withFreshToken(deps, account, (api) => pollWith(deps, account, api));
    const recovered = account.state !== 'ready';
    account.state = 'ready';
    account.message = null;
    account.failures = 0;
    account.synced = true;
    return { changed: changed || recovered, nextInMs: GOOGLE_POLL_MS };
  } catch (error) {
    if (error instanceof SignInAgain) return signInAgain(deps, account);
    if (error instanceof GoogleApiError && error.kind === 'unauthorized') {
      return signInAgain(deps, account);
    }
    account.failures += 1;
    const wasError = account.state === 'error';
    account.state = 'error';
    account.message = failureMessage(error);
    const retryAfter = error instanceof GoogleApiError ? error.retryAfterMs : null;
    return { changed: !wasError, nextInMs: backoffMs(account.failures, retryAfter, random()) };
  }
}
