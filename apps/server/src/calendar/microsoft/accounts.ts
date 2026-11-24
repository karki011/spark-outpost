import {
  MICROSOFT_CALENDAR_SCOPES,
  MICROSOFT_EDIT_SCOPES,
  type GoogleAccountState,
  type HelperCalendar,
} from '@spark-outpost/contracts';
import { withTransaction, type Db } from '../../persistence/db.ts';
import { microsoftCalendarSecret, type SecretStore } from '../../setup/secrets.ts';
import { rematchCalendars } from '../rematch.ts';
import { lockChoices, replaceChoices, savedChoices } from '../store.ts';
import { cloudOwner, markCloudSignIn, type CloudAccountRow } from '../cloud/account-store.ts';
import { syncWindow, type CalendarSync, type SyncWindow } from '../cloud/events.ts';
import {
  CLOUD_POLL_MS,
  TOKEN_MARGIN_MS,
  backoffMs,
  settleAll,
  type PollOutcome,
} from '../cloud/poll.ts';
import { GraphApiError, listMicrosoftCalendars, type GraphApiDeps } from './api.ts';
import type { MicrosoftClientConfig } from './config.ts';
import { mapMicrosoftCalendar } from './map.ts';
import { MicrosoftAuthError, refreshMicrosoftAccess } from './oauth.ts';
import { fullSync, syncCalendar, type MicrosoftTarget } from './sync.ts';

export const MICROSOFT_SIGN_IN_AGAIN =
  'Microsoft sign-in ran out. Sign in again to keep this account.';

export interface MicrosoftAccountDeps {
  db: Db;
  workspaceId: string;
  secrets: SecretStore;
  fetch: typeof fetch;
  client: MicrosoftClientConfig;
  now: () => number;
}

export interface MicrosoftLiveAccount {
  row: CloudAccountRow;
  accessToken: string | null;
  expiresAt: number;
  calendars: Map<string, CalendarSync>;
  seriesUids: Map<string, string | null>;
  deltaRefused: Map<string, string>;
  state: GoogleAccountState;
  message: string | null;
  failures: number;
  synced: boolean;
  syncedAt: number | null;
}

export function microsoftLiveAccount(row: CloudAccountRow): MicrosoftLiveAccount {
  return {
    row,
    accessToken: null,
    expiresAt: 0,
    calendars: new Map(),
    seriesUids: new Map(),
    deltaRefused: new Map(),
    state: row.needsSignIn ? 'sign_in_again' : 'syncing',
    message: row.needsSignIn ? MICROSOFT_SIGN_IN_AGAIN : null,
    failures: 0,
    synced: false,
    syncedAt: null,
  };
}

export class MicrosoftSignInAgain extends Error {}

export function scopesFor(row: CloudAccountRow): readonly string[] {
  return row.canEdit ? MICROSOFT_EDIT_SCOPES : MICROSOFT_CALENDAR_SCOPES;
}

async function accessToken(
  deps: MicrosoftAccountDeps,
  account: MicrosoftLiveAccount,
): Promise<string> {
  if (account.accessToken && account.expiresAt - TOKEN_MARGIN_MS > deps.now()) {
    return account.accessToken;
  }
  const secret = microsoftCalendarSecret(account.row.subject);
  const refreshToken = await deps.secrets.get(secret);
  if (!refreshToken) throw new MicrosoftSignInAgain();
  const answer = await refreshMicrosoftAccess(
    deps,
    { refreshToken, scopes: scopesFor(account.row) },
    deps.now(),
  );
  if (answer.kind === 'rejected') throw new MicrosoftSignInAgain();
  if (answer.refreshToken && answer.refreshToken !== refreshToken) {
    await deps.secrets.set(secret, answer.refreshToken);
  }
  account.accessToken = answer.accessToken;
  account.expiresAt = answer.expiresAt;
  return answer.accessToken;
}

export function microsoftTarget(
  account: MicrosoftLiveAccount,
  calendarId: string,
): MicrosoftTarget {
  return {
    accountId: account.row.id,
    calendarId,
    email: account.row.email,
    seriesUids: account.seriesUids,
    deltaRefused: account.deltaRefused,
  };
}

async function saveCalendars(
  deps: MicrosoftAccountDeps,
  accountId: string,
  calendars: readonly HelperCalendar[],
) {
  const owner = cloudOwner('microsoft', accountId);
  return withTransaction(deps.db, async (client) => {
    await lockChoices(client, deps.workspaceId, owner);
    const match = rematchCalendars(await savedChoices(client, deps.workspaceId, owner), calendars);
    if (match.changed) await replaceChoices(client, deps.workspaceId, match.writes, owner);
    return { choices: await savedChoices(client, deps.workspaceId, owner), changed: match.changed };
  });
}

export const microsoftPrefix = (accountId: string) => `microsoft:${accountId}:`;

export function isSkippable(error: unknown): boolean {
  return (
    error instanceof GraphApiError && ['forbidden', 'not_found', 'bad_request'].includes(error.kind)
  );
}

export async function withFreshToken<T>(
  deps: MicrosoftAccountDeps,
  account: MicrosoftLiveAccount,
  work: (api: GraphApiDeps) => Promise<T>,
): Promise<T> {
  const api = async (): Promise<GraphApiDeps> => ({
    fetch: deps.fetch,
    graphUrl: deps.client.graphUrl,
    accessToken: await accessToken(deps, account),
  });
  try {
    return await work(await api());
  } catch (error) {
    if (!(error instanceof GraphApiError) || error.kind !== 'unauthorized') throw error;
    account.accessToken = null;
    return work(await api());
  }
}

async function pollWith(
  deps: MicrosoftAccountDeps,
  account: MicrosoftLiveAccount,
  api: GraphApiDeps,
) {
  const entries = await listMicrosoftCalendars(api);
  const mapped = entries.flatMap((entry) => {
    const calendar = mapMicrosoftCalendar(account.row.id, account.row.email, entry);
    return calendar ? [calendar] : [];
  });
  const saved = await saveCalendars(deps, account.row.id, mapped);
  const window = syncWindow(deps.now());
  for (const [calendarId, windowKey] of account.deltaRefused) {
    if (windowKey !== window.key) account.deltaRefused.delete(calendarId);
  }
  const prefix = microsoftPrefix(account.row.id);
  const wanted = saved.choices
    .filter((choice) => choice.include && choice.calendarId.startsWith(prefix))
    .map((choice) => choice.calendarId.slice(prefix.length));
  let changed = saved.changed;
  const next = new Map<string, CalendarSync>();
  for (const calendarId of wanted) {
    const previous = account.calendars.get(calendarId) ?? null;
    try {
      const target = microsoftTarget(account, calendarId);
      const result = await syncCalendar(api, target, previous, window);
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

export async function microsoftAccountRange(
  deps: MicrosoftAccountDeps,
  account: MicrosoftLiveAccount,
  range: SyncWindow,
): Promise<Map<string, CalendarSync>> {
  return withFreshToken(deps, account, async (api) => {
    const calendarIds = [...account.calendars.keys()];
    const results = await settleAll(calendarIds, (calendarId) =>
      fullSync(api, microsoftTarget(account, calendarId), range),
    );
    const found = new Map<string, CalendarSync>();
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') found.set(calendarIds[index]!, result.value);
      else if (!isSkippable(result.reason)) throw result.reason;
    });
    return found;
  });
}

function failureMessage(error: unknown): string {
  if (error instanceof GraphApiError && error.kind === 'rate_limited') {
    return 'Microsoft asked Spark to slow down. Trying again soon.';
  }
  if (error instanceof GraphApiError || error instanceof MicrosoftAuthError) {
    return `${error.message} Trying again soon.`;
  }
  return 'Couldn’t read this Microsoft account. Trying again soon.';
}

export function needsSignInAgain(error: unknown): boolean {
  return (
    error instanceof MicrosoftSignInAgain ||
    (error instanceof GraphApiError && error.kind === 'unauthorized')
  );
}

export async function markSignInAgain(
  deps: MicrosoftAccountDeps,
  account: MicrosoftLiveAccount,
): Promise<void> {
  account.accessToken = null;
  account.synced = false;
  account.state = 'sign_in_again';
  account.message = MICROSOFT_SIGN_IN_AGAIN;
  await markCloudSignIn(deps.db, 'microsoft', deps.workspaceId, account.row.id, true);
  account.row = { ...account.row, needsSignIn: true };
}

export async function pollMicrosoftAccount(
  deps: MicrosoftAccountDeps,
  account: MicrosoftLiveAccount,
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
    account.syncedAt = deps.now();
    return { changed: changed || recovered, nextInMs: CLOUD_POLL_MS };
  } catch (error) {
    if (needsSignInAgain(error)) {
      await markSignInAgain(deps, account);
      return { changed: true, nextInMs: null };
    }
    account.failures += 1;
    const wasError = account.state === 'error';
    account.state = 'error';
    account.message = failureMessage(error);
    const retryAfter = error instanceof GraphApiError ? error.retryAfterMs : null;
    return { changed: !wasError, nextInMs: backoffMs(account.failures, retryAfter, random()) };
  }
}
