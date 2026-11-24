import { expect } from 'vitest';
import {
  calendarDaySchema,
  calendarStatusSchema,
  googleSignInFlowSchema,
} from '@spark-outpost/contracts';
import { createApp } from '../src/api/app.ts';
import type { GraphEvent } from '../src/calendar/microsoft/api.ts';
import { createMicrosoftSource, type MicrosoftSource } from '../src/calendar/microsoft/source.ts';
import { dateKey } from '../src/calendar/service.ts';
import { memorySecretStore, type SecretStore } from '../src/setup/secrets.ts';
import { localClient, testAppOptions } from './app-support.ts';
import {
  FAKE_MICROSOFT_CLIENT_ID,
  fakeMicrosoftGraph,
  type FakeGraph,
} from './fake-microsoft-graph.ts';
import { macHost, noon, type MacHost } from './google-calendar-support.ts';
import type { TestDb } from './support.ts';

export const OID = '00000000-0000-0000-66f3-3332eca7ea81';
export const MS_EMAIL = 'owner@contoso.com';
export const MS_CALENDAR = 'AAMkAGI2TGuLAAA=';

export interface MicrosoftHarness {
  fake: FakeGraph;
  secrets: SecretStore;
  microsoft: MicrosoftSource;
  host: MacHost;
  client: ReturnType<typeof localClient>;
}

export function microsoftHarness(t: TestDb, options: { mac?: boolean } = {}): MicrosoftHarness {
  const fake = fakeMicrosoftGraph();
  fake.addUser(OID, MS_EMAIL);
  fake.addCalendar(OID, {
    id: MS_CALENDAR,
    name: 'Calendar',
    hexColor: '#e0f0ff',
    canEdit: true,
    isDefaultCalendar: true,
    owner: { name: 'Owner', address: MS_EMAIL },
  });
  const secrets = memorySecretStore();
  const microsoft = createMicrosoftSource({
    db: t.db,
    workspaceId: t.workspaceId,
    secrets,
    fetch: (input, init) => fake.fetch(input, init),
    random: () => 0.5,
    client: {
      clientId: FAKE_MICROSOFT_CLIENT_ID,
      loginUrl: fake.loginUrl,
      graphUrl: fake.graphUrl,
    },
  });
  const host = macHost(options.mac ?? false);
  const client = localClient(
    createApp({ ...testAppOptions(t), calendarHost: host, microsoftCalendar: microsoft }),
  );
  return { fake, secrets, microsoft, host, client };
}

export async function msStatus(harness: MicrosoftHarness) {
  const response = await harness.client.get('/api/calendar/status');
  expect(response.status).toBe(200);
  return calendarStatusSchema.parse(response.body);
}

export async function startMsSignIn(
  harness: MicrosoftHarness,
  accountId?: string,
  editCalendar?: string,
) {
  const response = await harness.client.send('post', '/api/calendar/microsoft/sign-in', {
    ...(accountId ? { accountId } : {}),
    ...(editCalendar ? { editCalendar } : {}),
  });
  expect(response.status).toBe(200);
  return googleSignInFlowSchema.parse(response.body);
}

export async function msSignIn(
  harness: MicrosoftHarness,
  accountId?: string,
  editCalendar?: string,
) {
  const flow = await startMsSignIn(harness, accountId, editCalendar);
  const back = await fetch(harness.fake.authorize(flow.authorizeUrl!));
  expect(back.status).toBe(200);
  await harness.microsoft.signInSettled();
  await harness.microsoft.syncNow();
  return harness.microsoft.signInFlow();
}

export async function msToday(harness: MicrosoftHarness) {
  const response = await harness.client.get(`/api/calendar/day?date=${dateKey(Date.now())}`);
  expect(response.status).toBe(200);
  return calendarDaySchema.parse(response.body);
}

const graphTime = (iso: string) => ({
  dateTime: new Date(iso).toISOString().replace('Z', '0000'),
  timeZone: 'UTC',
});

export function graphMeeting(
  id: string,
  afterNoon: number,
  extra: Partial<GraphEvent> = {},
): GraphEvent {
  return {
    id,
    iCalUId: `040000008200E00074C5B7101A82E008${id}`,
    type: 'singleInstance',
    subject: id,
    start: graphTime(noon(afterNoon)),
    end: graphTime(noon(afterNoon + 30)),
    showAs: 'busy',
    isOrganizer: true,
    responseStatus: { response: 'organizer' },
    ...extra,
  };
}
