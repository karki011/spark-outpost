import type {
  CalendarEventDetail,
  CalendarGoogleStatus,
  GoogleSignInFlow,
  HelperEvent,
} from '@spark-outpost/contracts';
import type { Db } from '../../persistence/db.ts';
import { googleCalendarSecret, type SecretStore } from '../../setup/secrets.ts';
import { liveAccount, pollAccount, type AccountDeps, type LiveAccount } from './accounts.ts';
import type { GoogleClientConfig } from './config.ts';
import { splitGoogleEventId } from './map.ts';
import { revokeGoogleToken, type GoogleGrant } from './oauth.ts';
import { GoogleAccountMismatch, createGoogleSignIn, type GoogleSignIn } from './sign-in.ts';
import { deleteGoogleAccount, googleAccounts, saveGoogleAccount } from './store.ts';
import { eventsInWindow, googleWindow } from './sync.ts';
import { forgetMarksOf } from '../store.ts';

function accountUids(account: LiveAccount): string[] {
  const uids = new Set<string>();
  for (const sync of account.calendars.values()) {
    for (const { event } of sync.events.values()) uids.add(event.uid ?? event.id);
  }
  return [...uids];
}

export interface GoogleSourceDeps {
  db: Db;
  workspaceId: string;
  secrets: SecretStore;
  fetch: typeof fetch;
  client: GoogleClientConfig | null;
  now?: () => number;
  random?: () => number;
}

export interface GoogleWindowEvents {
  events: HelperEvent[];
  truncated: boolean;
}

export interface GoogleSource {
  start(): Promise<void>;
  reconcile(): Promise<void>;
  stop(): void;
  status(): CalendarGoogleStatus;
  ready(): boolean;
  window(): GoogleWindowEvents;
  detail(occurrence: { eventId: string; start: string }): CalendarEventDetail | null;
  signIn(request: { accountId: string | null }): Promise<GoogleSignInFlow>;
  signInFlow(): GoogleSignInFlow;
  cancelSignIn(): GoogleSignInFlow;
  signInSettled(): Promise<void>;
  disconnect(
    accountId: string,
    shownElsewhere?: readonly string[],
  ): Promise<{ found: boolean; revoked: boolean }>;
  refresh(): void;
  syncNow(): Promise<void>;
  onChanged(listener: () => void): void;
}

const IDLE_FLOW: GoogleSignInFlow = {
  status: 'idle',
  authorizeUrl: null,
  expiresAt: null,
  message: null,
};

export class GoogleUnavailable extends Error {
  constructor() {
    super('This build has no Google sign-in. Add a Google OAuth client to use Google Calendar.');
  }
}

export function createGoogleSource(deps: GoogleSourceDeps): GoogleSource {
  const now = deps.now ?? Date.now;
  const accounts = new Map<string, LiveAccount>();
  const timers = new Map<string, NodeJS.Timeout>();
  const running = new Map<string, Promise<void>>();
  const listeners = new Set<() => void>();
  let stopped = false;
  const client = deps.client;
  const accountDeps: AccountDeps | null = client
    ? {
        db: deps.db,
        workspaceId: deps.workspaceId,
        secrets: deps.secrets,
        fetch: deps.fetch,
        client,
        now,
      }
    : null;

  const emit = () => {
    for (const listener of listeners) listener();
  };

  const schedule = (accountId: string, delayMs: number | null) => {
    clearTimeout(timers.get(accountId));
    timers.delete(accountId);
    if (delayMs === null || stopped) return;
    const timer = setTimeout(() => void poll(accountId), delayMs);
    timer.unref();
    timers.set(accountId, timer);
  };

  function poll(accountId: string): Promise<void> {
    const active = running.get(accountId);
    if (active) return active;
    const account = accounts.get(accountId);
    if (!account || !accountDeps) return Promise.resolve();
    const work = pollAccount(accountDeps, account, deps.random)
      .then((outcome) => {
        if (accounts.get(accountId) !== account) return;
        schedule(accountId, outcome.nextInMs);
        if (outcome.changed) emit();
      })
      .catch((error: unknown) => {
        console.error('Google Calendar sync failed', (error as Error).message);
      })
      .finally(() => running.delete(accountId));
    running.set(accountId, work);
    return work;
  }

  const knownSubject = (subject: string) =>
    [...accounts.values()].some((account) => account.row.subject === subject);

  async function discard(grant: GoogleGrant): Promise<void> {
    if (knownSubject(grant.subject)) return;
    await revokeGoogleToken({ fetch: deps.fetch, client: client! }, grant.refreshToken);
  }

  async function connect(grant: GoogleGrant, accountId: string | null): Promise<void> {
    const wanted = accountId ? accounts.get(accountId) : undefined;
    if (wanted && wanted.row.subject !== grant.subject) {
      await discard(grant);
      throw new GoogleAccountMismatch(wanted.row.email);
    }
    await deps.secrets.set(googleCalendarSecret(grant.subject), grant.refreshToken);
    const row = await saveGoogleAccount(deps.db, deps.workspaceId, {
      subject: grant.subject,
      email: grant.email,
    });
    const account = accounts.get(row.id) ?? liveAccount(row);
    account.row = row;
    account.accessToken = grant.accessToken;
    account.expiresAt = grant.expiresAt;
    account.state = 'syncing';
    account.message = null;
    accounts.set(row.id, account);
    emit();
    void poll(row.id);
  }

  async function reconcile(): Promise<void> {
    if (!accountDeps) return;
    const rows = await googleAccounts(deps.db, deps.workspaceId);
    const saved = new Set(rows.map((row) => row.id));
    for (const accountId of [...accounts.keys()]) {
      if (saved.has(accountId)) continue;
      schedule(accountId, null);
      accounts.delete(accountId);
    }
    for (const row of rows) {
      if (accounts.has(row.id)) continue;
      accounts.set(row.id, liveAccount(row));
      void poll(row.id);
    }
  }

  const signIn: GoogleSignIn | null = client
    ? createGoogleSignIn({ fetch: deps.fetch, client, now, connect, discard })
    : null;

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
        testing: client !== null && !client.verified,
        accounts: [...accounts.values()].map((account) => ({
          id: account.row.id,
          email: account.row.email,
          state: account.state,
          message: account.message,
        })),
        signIn: signIn?.flow() ?? IDLE_FLOW,
      };
    },
    ready: () =>
      [...accounts.values()].some((account) => account.synced && account.state !== 'sign_in_again'),
    window() {
      const window = googleWindow(now());
      const events: HelperEvent[] = [];
      let truncated = false;
      for (const account of accounts.values()) {
        if (account.state === 'sign_in_again') continue;
        for (const sync of account.calendars.values()) {
          truncated ||= sync.truncated;
          events.push(...eventsInWindow(sync, window).map((entry) => entry.event));
        }
      }
      return { events, truncated };
    },
    detail(occurrence) {
      const parts = splitGoogleEventId(occurrence.eventId);
      const account = parts ? accounts.get(parts.accountId) : undefined;
      if (!account) return null;
      const at = Date.parse(occurrence.start);
      for (const sync of account.calendars.values()) {
        const found = sync.events.get(occurrence.eventId);
        if (found && Date.parse(found.event.start) === at) {
          return { title: found.event.title, notes: found.notes, link: found.link };
        }
      }
      return null;
    },
    async signIn(request) {
      if (!signIn) throw new GoogleUnavailable();
      const account = request.accountId ? accounts.get(request.accountId) : undefined;
      return signIn.start({
        accountId: account?.row.id ?? null,
        loginHint: account?.row.email ?? null,
      });
    },
    signInFlow: () => signIn?.flow() ?? IDLE_FLOW,
    cancelSignIn: () => signIn?.cancel() ?? IDLE_FLOW,
    signInSettled: () => signIn?.settled() ?? Promise.resolve(),
    async disconnect(accountId, shownElsewhere = []) {
      const account = accounts.get(accountId);
      const rows = account ? [account.row] : await googleAccounts(deps.db, deps.workspaceId);
      const row = rows.find((candidate) => candidate.id === accountId);
      if (!row) return { found: false, revoked: false };
      schedule(accountId, null);
      accounts.delete(accountId);
      const kept = new Set([
        ...shownElsewhere,
        ...[...accounts.values()].flatMap((other) => accountUids(other)),
      ]);
      const gone = account ? accountUids(account).filter((uid) => !kept.has(uid)) : [];
      await forgetMarksOf(deps.db, deps.workspaceId, gone);
      const secret = googleCalendarSecret(row.subject);
      const token = await deps.secrets.get(secret).catch(() => null);
      const revoked =
        token && client ? await revokeGoogleToken({ fetch: deps.fetch, client }, token) : !token;
      await deps.secrets.delete(secret);
      await deleteGoogleAccount(deps.db, deps.workspaceId, accountId);
      emit();
      return { found: true, revoked };
    },
    refresh() {
      for (const accountId of accounts.keys()) schedule(accountId, 0);
    },
    async syncNow() {
      await Promise.all([...accounts.keys()].map((accountId) => poll(accountId)));
    },
    onChanged: (listener) => listeners.add(listener),
  };
}
