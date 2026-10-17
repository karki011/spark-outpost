import { expect } from 'vitest';
import {
  calendarDaySchema,
  calendarStatusSchema,
  googleSignInFlowSchema,
  type CalendarHostRequest,
  type HelperCalendar,
  type HelperEvent,
} from '@spark-outpost/contracts';
import { createApp } from '../src/api/app.ts';
import { dateKey } from '../src/calendar/service.ts';
import type { CalendarHost } from '../src/calendar/host-client.ts';
import { createGoogleSource, type GoogleSource } from '../src/calendar/google/source.ts';
import { memorySecretStore, type SecretStore } from '../src/setup/secrets.ts';
import { localClient, testAppOptions } from './app-support.ts';
import {
  FAKE_GOOGLE_CLIENT_ID,
  FAKE_GOOGLE_CLIENT_SECRET,
  fakeGoogleCalendar,
  type FakeGoogle,
} from './fake-google-calendar.ts';
import type { TestDb } from './support.ts';

export const MINUTE = 60_000;
export const SUBJECT = '1080000000000000001';
export const EMAIL = 'owner@example.com';

export function at(minutesFromNow: number): string {
  return new Date(Date.now() + minutesFromNow * MINUTE).toISOString();
}

export function noon(minutesAfter = 0): string {
  const day = new Date();
  day.setHours(12, 0, 0, 0);
  return new Date(day.getTime() + minutesAfter * MINUTE).toISOString();
}

export interface MacHost extends CalendarHost {
  calendars: HelperCalendar[];
  events: HelperEvent[];
}

export function macHost(connected: boolean): MacHost {
  const host = {
    calendars: [] as HelperCalendar[],
    events: [] as HelperEvent[],
    onChanged: () => undefined,
    request: async (request: CalendarHostRequest) => {
      if (request.op === 'status') {
        return { helper: 'ready', authorization: connected ? 'fullAccess' : 'notDetermined' };
      }
      if (request.op === 'request') return { authorization: 'fullAccess' };
      if (request.op === 'calendars') return { calendars: host.calendars };
      if (request.op === 'window') {
        return { events: host.events, truncated: false, from: at(-3000), to: at(15000) };
      }
      return { stopped: true };
    },
  };
  return host as unknown as MacHost;
}

export interface Harness {
  fake: FakeGoogle;
  secrets: SecretStore;
  google: GoogleSource;
  host: MacHost;
  client: ReturnType<typeof localClient>;
}

export function googleHarness(t: TestDb, options: { mac?: boolean } = {}): Harness {
  const fake = fakeGoogleCalendar('http://127.0.0.1:9');
  fake.addUser(SUBJECT, EMAIL);
  fake.addCalendar(SUBJECT, {
    id: EMAIL,
    summary: EMAIL,
    accessRole: 'owner',
    primary: true,
    backgroundColor: '#9fe1e7',
  });
  const secrets = memorySecretStore();
  const google = createGoogleSource({
    db: t.db,
    workspaceId: t.workspaceId,
    secrets,
    fetch: fake.fetch,
    random: () => 0.5,
    client: {
      clientId: FAKE_GOOGLE_CLIENT_ID,
      clientSecret: FAKE_GOOGLE_CLIENT_SECRET,
      verified: false,
      accountsUrl: fake.baseUrl,
      oauthUrl: fake.baseUrl,
      apiUrl: `${fake.baseUrl}/calendar/v3`,
    },
  });
  const host = macHost(options.mac ?? false);
  const client = localClient(
    createApp({ ...testAppOptions(t), calendarHost: host, googleCalendar: google }),
  );
  return { fake, secrets, google, host, client };
}

export async function status(harness: Harness) {
  const response = await harness.client.get('/api/calendar/status');
  expect(response.status).toBe(200);
  return calendarStatusSchema.parse(response.body);
}

export async function startSignIn(harness: Harness, accountId?: string) {
  const response = await harness.client.send(
    'post',
    '/api/calendar/google/sign-in',
    accountId ? { accountId } : {},
  );
  expect(response.status).toBe(200);
  return googleSignInFlowSchema.parse(response.body);
}

export async function signIn(harness: Harness, accountId?: string) {
  const flow = await startSignIn(harness, accountId);
  const back = await fetch(harness.fake.authorize(flow.authorizeUrl!));
  expect(back.status).toBe(200);
  await harness.google.signInSettled();
  await harness.google.syncNow();
  return harness.google.signInFlow();
}

export async function today(harness: Harness) {
  const response = await harness.client.get(`/api/calendar/day?date=${dateKey(Date.now())}`);
  expect(response.status).toBe(200);
  return calendarDaySchema.parse(response.body);
}

export function meeting(id: string, afterNoon: number, extra: object = {}) {
  return {
    id,
    iCalUID: `${id}@google.com`,
    summary: id,
    start: { dateTime: noon(afterNoon) },
    end: { dateTime: noon(afterNoon + 30) },
    ...extra,
  };
}
