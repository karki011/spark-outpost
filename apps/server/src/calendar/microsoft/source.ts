import {
  microsoftScopesEdit,
  type CalendarEventDetail,
  type CalendarMicrosoftStatus,
  type GoogleSignInFlow,
} from '@spark-outpost/contracts';
import type { Db } from '../../persistence/db.ts';
import { microsoftCalendarSecret, type SecretStore } from '../../setup/secrets.ts';
import {
  cloudAccounts,
  deleteCloudAccount,
  saveCloudAccount,
  setCloudAgentsEdit,
} from '../cloud/account-store.ts';
import {
  collectEvents,
  covers,
  findStored,
  syncWindow,
  type StoredEvent,
  type WindowEvents,
} from '../cloud/events.ts';
import { createRangeCache } from '../cloud/range.ts';
import { splitNotes } from '../notes-text.ts';
import { locationOf, peopleOf } from '../people.ts';
import { forgetMarksOf } from '../store.ts';
import {
  isSkippable,
  markSignInAgain,
  microsoftAccountRange,
  microsoftLiveAccount,
  microsoftPrefix,
  microsoftTarget,
  needsSignInAgain,
  pollMicrosoftAccount,
  withFreshToken,
  type MicrosoftAccountDeps,
  type MicrosoftLiveAccount,
} from './accounts.ts';
import { getMicrosoftEvent, microsoftMe } from './api.ts';
import type { MicrosoftClientConfig } from './config.ts';
import { splitMicrosoftEventId } from './map.ts';
import type { MicrosoftGrant } from './oauth.ts';
import {
  MicrosoftAccountMismatch,
  createMicrosoftSignIn,
  type MicrosoftConnected,
  type MicrosoftSignIn,
  type MicrosoftSignInRequest,
} from './sign-in.ts';
import { resolveSeries, storedMicrosoftEvent } from './sync.ts';

export interface MicrosoftOccurrence {
  eventId: string;
  start: string;
  calendarId: string | null;
}

export class MicrosoftSignInNeeded extends Error {
  constructor() {
    super('Sign in to Microsoft again to see this event.');
  }
}

export class MicrosoftUnavailable extends Error {
  constructor() {
    super(
      'This build has no Microsoft sign-in. Add a Microsoft app client ID to use Microsoft calendars.',
    );
  }
}

export interface MicrosoftSourceDeps {
  db: Db;
  workspaceId: string;
  secrets: SecretStore;
  fetch: typeof fetch;
  client: MicrosoftClientConfig | null;
  now?: () => number;
  random?: () => number;
}

export interface MicrosoftSource {
  start(): Promise<void>;
  reconcile(): Promise<void>;
  stop(): void;
  status(): CalendarMicrosoftStatus;
  ready(): boolean;
  window(): WindowEvents;
  range(from: number, to: number): Promise<WindowEvents>;
  detail(occurrence: MicrosoftOccurrence): Promise<CalendarEventDetail | null>;
  signIn(request: MicrosoftSignInRequest): Promise<GoogleSignInFlow>;
  signInFlow(): GoogleSignInFlow;
  cancelSignIn(): GoogleSignInFlow;
  signInSettled(): Promise<void>;
  disconnect(accountId: string, shownElsewhere?: readonly string[]): Promise<{ found: boolean }>;
  uids(): string[];
  refresh(): void;
  refreshNow(): Promise<void>;
  syncNow(): Promise<void>;
  onChanged(listener: () => void): void;
}

const IDLE_FLOW: GoogleSignInFlow = {
  status: 'idle',
  authorizeUrl: null,
  expiresAt: null,
  message: null,
};

function accountUids(account: MicrosoftLiveAccount): string[] {
  const uids = new Set<string>();
  for (const sync of account.calendars.values()) {
    for (const { event } of sync.events.values()) uids.add(event.uid ?? event.id);
  }
  return [...uids];
}

export function createMicrosoftSource(deps: MicrosoftSourceDeps): MicrosoftSource {
  const now = deps.now ?? Date.now;
  const accounts = new Map<string, MicrosoftLiveAccount>();
  const timers = new Map<string, NodeJS.Timeout>();
  const running = new Map<string, Promise<void>>();
  const listeners = new Set<() => void>();
  let stopped = false;
  const client = deps.client;
  const accountDeps: MicrosoftAccountDeps | null = client
    ? {
        db: deps.db,
        workspaceId: deps.workspaceId,
        secrets: deps.secrets,
        fetch: deps.fetch,
        client,
        now,
      }
    : null;

  const ranges = accountDeps
    ? createRangeCache<MicrosoftLiveAccount>({
        now,
        label: 'Microsoft Calendar',
        idOf: (account) => account.row.id,
        load: (account, window) => microsoftAccountRange(accountDeps, account, window),
      })
    : null;
  const usable = () =>
    [...accounts.values()].filter((account) => account.state !== 'sign_in_again');

  const emit = () => {
    for (const listener of listeners) listener();
  };

  const windowEvents = (bounds: { from: number; to: number }): WindowEvents =>
    collectEvents(
      usable().flatMap((account) => [...account.calendars.values()]),
      bounds,
    );

  const schedule = (accountId: string, delayMs: number | null) => {
    clearTimeout(timers.get(accountId));
    timers.delete(accountId);
    if (delayMs === null || stopped) return;
    const timer = setTimeout(() => void poll(accountId), delayMs);
    timer.unref();
    timers.set(accountId, timer);
  };

  const fetchEvent = async (
    account: MicrosoftLiveAccount,
    occurrence: MicrosoftOccurrence,
  ): Promise<StoredEvent | null> => {
    const graphId = splitMicrosoftEventId(occurrence.eventId)?.eventId;
    const prefix = microsoftPrefix(account.row.id);
    const calendarId = occurrence.calendarId?.startsWith(prefix)
      ? occurrence.calendarId.slice(prefix.length)
      : null;
    if (!accountDeps || !graphId || !calendarId) return null;
    try {
      const target = microsoftTarget(account, calendarId);
      const found = await withFreshToken(accountDeps, account, async (api) => {
        const raw = await getMicrosoftEvent(api, calendarId, graphId);
        await resolveSeries(api, target, [raw]);
        return storedMicrosoftEvent(target, raw);
      });
      return found && Date.parse(found.event.start) === Date.parse(occurrence.start) ? found : null;
    } catch (error) {
      if (isSkippable(error)) return null;
      if (!needsSignInAgain(error)) throw error;
      await markSignInAgain(accountDeps, account);
      schedule(account.row.id, null);
      emit();
      throw new MicrosoftSignInNeeded();
    }
  };

  function poll(accountId: string): Promise<void> {
    const active = running.get(accountId);
    if (active) return active;
    const account = accounts.get(accountId);
    if (!account || !accountDeps) return Promise.resolve();
    const work = pollMicrosoftAccount(accountDeps, account, deps.random)
      .then((outcome) => {
        if (accounts.get(accountId) !== account) return;
        schedule(accountId, outcome.nextInMs);
        if (outcome.changed) {
          ranges?.dropAccount(accountId);
          emit();
        }
      })
      .catch((error: unknown) => {
        console.error('Microsoft Calendar sync failed', (error as Error).message);
      })
      .finally(() => running.delete(accountId));
    running.set(accountId, work);
    return work;
  }

  async function emailOf(grant: MicrosoftGrant): Promise<string | null> {
    if (!client) return null;
    return microsoftMe({
      fetch: deps.fetch,
      graphUrl: client.graphUrl,
      accessToken: grant.accessToken,
    });
  }

  async function connect(
    grant: MicrosoftGrant & { email: string },
    request: MicrosoftSignInRequest,
  ): Promise<MicrosoftConnected> {
    const wanted = request.accountId ? accounts.get(request.accountId) : undefined;
    if (wanted && wanted.row.subject !== grant.subject) {
      throw new MicrosoftAccountMismatch(wanted.row.email);
    }
    await deps.secrets.set(microsoftCalendarSecret(grant.subject), grant.refreshToken);
    const row = await saveCloudAccount(deps.db, 'microsoft', deps.workspaceId, {
      subject: grant.subject,
      email: grant.email,
      canEdit: microsoftScopesEdit(grant.scopes),
    });
    const edit = await setCloudAgentsEdit(
      deps.db,
      'microsoft',
      deps.workspaceId,
      row,
      request.editCalendar,
    );
    const account = accounts.get(row.id) ?? microsoftLiveAccount(row);
    account.row = row;
    account.accessToken = grant.accessToken;
    account.expiresAt = grant.expiresAt;
    account.state = 'syncing';
    account.message = null;
    accounts.set(row.id, account);
    ranges?.clear();
    emit();
    void poll(row.id);
    return { editTurnedOff: edit.turnedOff };
  }

  async function reconcile(): Promise<void> {
    if (!accountDeps) return;
    const rows = await cloudAccounts(deps.db, 'microsoft', deps.workspaceId);
    const saved = new Set(rows.map((row) => row.id));
    for (const accountId of [...accounts.keys()]) {
      if (saved.has(accountId)) continue;
      schedule(accountId, null);
      accounts.delete(accountId);
    }
    for (const row of rows) {
      if (accounts.has(row.id)) continue;
      accounts.set(row.id, microsoftLiveAccount(row));
      void poll(row.id);
    }
  }

  const signIn: MicrosoftSignIn | null = client
    ? createMicrosoftSignIn({ fetch: deps.fetch, client, now, emailOf, connect })
    : null;

  const detailOf = (found: StoredEvent): CalendarEventDetail => ({
    title: found.event.title,
    notes: found.notes,
    ...splitNotes(found.notes),
    snippet: found.snippet,
    link: found.link,
    location: locationOf(found.event.location, found.invitees),
    attendees: peopleOf(found.invitees),
  });

  return {
    start: reconcile,
    reconcile,
    stop() {
      stopped = true;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      signIn?.cancel();
    },
    status() {
      return {
        available: client !== null,
        accounts: [...accounts.values()].map((account) => ({
          id: account.row.id,
          email: account.row.email,
          state: account.state,
          message: account.message,
          canEdit: account.row.canEdit,
          syncedAt: account.syncedAt === null ? null : new Date(account.syncedAt).toISOString(),
        })),
        signIn: signIn?.flow() ?? IDLE_FLOW,
      };
    },
    ready: () =>
      [...accounts.values()].some((account) => account.synced && account.state !== 'sign_in_again'),
    window: () => windowEvents(syncWindow(now())),
    async range(from, to) {
      const window = syncWindow(now());
      const storedCovers = usable().every((account) =>
        [...account.calendars.values()].every((sync) => sync.windowKey === window.key),
      );
      if (storedCovers && covers(window, { from, to })) return windowEvents({ from, to });
      if (!ranges) return { events: [], truncated: false };
      return ranges.read({ key: `${from}|${to}`, from, to }, usable());
    },
    async detail(occurrence) {
      const parts = splitMicrosoftEventId(occurrence.eventId);
      const account = parts ? accounts.get(parts.accountId) : undefined;
      if (!account) return null;
      const at = Date.parse(occurrence.start);
      const stored = findStored(account.calendars.values(), occurrence.eventId, at);
      if (!stored && account.state === 'sign_in_again') throw new MicrosoftSignInNeeded();
      const found = stored ?? (await fetchEvent(account, occurrence));
      return found ? detailOf(found) : null;
    },
    async signIn(request) {
      if (!signIn) throw new MicrosoftUnavailable();
      const account = request.accountId ? accounts.get(request.accountId) : undefined;
      return signIn.start({
        accountId: account?.row.id ?? null,
        editCalendar: account ? request.editCalendar : null,
        loginHint: account?.row.email ?? null,
        keepEdit: account?.row.canEdit ?? false,
      });
    },
    signInFlow: () => signIn?.flow() ?? IDLE_FLOW,
    cancelSignIn: () => signIn?.cancel() ?? IDLE_FLOW,
    signInSettled: () => signIn?.settled() ?? Promise.resolve(),
    async disconnect(accountId, shownElsewhere = []) {
      const account = accounts.get(accountId);
      const rows = account
        ? [account.row]
        : await cloudAccounts(deps.db, 'microsoft', deps.workspaceId);
      const row = rows.find((candidate) => candidate.id === accountId);
      if (!row) return { found: false };
      schedule(accountId, null);
      accounts.delete(accountId);
      const kept = new Set([
        ...shownElsewhere,
        ...[...accounts.values()].flatMap((other) => accountUids(other)),
      ]);
      const gone = account ? accountUids(account).filter((uid) => !kept.has(uid)) : [];
      await forgetMarksOf(deps.db, deps.workspaceId, gone);
      await deps.secrets.delete(microsoftCalendarSecret(row.subject));
      await deleteCloudAccount(deps.db, 'microsoft', deps.workspaceId, accountId);
      ranges?.clear();
      emit();
      return { found: true };
    },
    uids: () => [...accounts.values()].flatMap((account) => accountUids(account)),
    refresh() {
      ranges?.clear();
      for (const accountId of accounts.keys()) schedule(accountId, 0);
    },
    async refreshNow() {
      const due = [...accounts.values()].filter(
        (account) => account.failures === 0 && account.state !== 'sign_in_again',
      );
      await Promise.all(due.map((account) => poll(account.row.id)));
    },
    async syncNow() {
      await Promise.all([...accounts.keys()].map((accountId) => poll(accountId)));
    },
    onChanged: (listener) => listeners.add(listener),
  };
}
