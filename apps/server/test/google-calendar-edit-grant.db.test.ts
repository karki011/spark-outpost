import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  GOOGLE_CALENDAR_LIST_SCOPE,
  GOOGLE_EDIT_DECLINED,
  GOOGLE_EDIT_NEEDS_GRANT,
  GOOGLE_EVENTS_EDIT_SCOPE,
  GOOGLE_EVENTS_READ_SCOPE,
} from '@spark-outpost/contracts';
import {
  EMAIL,
  SUBJECT,
  googleHarness,
  signIn,
  startSignIn,
  status,
  type Harness,
} from './google-calendar-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const READ_ONLY = ['openid', 'email', GOOGLE_CALENDAR_LIST_SCOPE, GOOGLE_EVENTS_READ_SCOPE];

let t: TestDb;
let h: Harness;

beforeEach(async () => {
  t = await createTestDb();
  h = googleHarness(t);
});

afterEach(async () => {
  h.google.stop();
  await t.cleanup();
});

async function google() {
  const after = await status(h);
  return { account: after.google.accounts[0]!, calendar: after.accounts[0]!.calendars[0]! };
}

async function connected() {
  await signIn(h);
  const { account, calendar } = await google();
  return { accountId: account.id, key: calendar.key! };
}

describe('Allowing agents to edit a Google calendar', () => {
  it('signs in without the editing scope and refuses Agents can edit until Google allows it', async () => {
    const { key } = await connected();
    expect((await google()).account.canEdit).toBe(false);
    const refused = await h.client.send('patch', `/api/calendar/calendars/${key}`, {
      agentsEdit: true,
    });
    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.body)).toContain(GOOGLE_EDIT_NEEDS_GRANT);
    expect((await google()).calendar.agentsEdit).toBe(false);
  });

  it('asks Google for event editing on that account only, then turns the switch on', async () => {
    const { accountId, key } = await connected();
    const flow = await startSignIn(h, accountId, key);
    const url = new URL(flow.authorizeUrl!);
    expect(url.searchParams.get('scope')!.split(' ')).toContain(GOOGLE_EVENTS_EDIT_SCOPE);
    expect(url.searchParams.get('include_granted_scopes')).toBe('true');
    expect(url.searchParams.get('login_hint')).toBe(EMAIL);
    expect((await signIn(h, accountId, key)).status).toBe('connected');
    const after = await google();
    expect(after.account.canEdit).toBe(true);
    expect(after.calendar.agentsEdit).toBe(true);
  });

  it('keeps the switch off with a note when the user declines in Google', async () => {
    const { accountId, key } = await connected();
    h.fake.deny = 'access_denied';
    expect((await signIn(h, accountId, key)).message).toBe(GOOGLE_EDIT_DECLINED);
    h.fake.deny = null;
    h.fake.grantedScopes = READ_ONLY;
    expect((await signIn(h, accountId, key)).message).toBe(GOOGLE_EDIT_DECLINED);
    const after = await google();
    expect(after.account).toMatchObject({ state: 'ready', canEdit: false });
    expect(after.calendar.agentsEdit).toBe(false);
  });

  it('turns Agents can edit off when a later grant no longer allows editing', async () => {
    const { accountId, key } = await connected();
    await signIn(h, accountId, key);
    expect((await google()).calendar.agentsEdit).toBe(true);
    h.fake.forgetGrants(SUBJECT);
    h.fake.grantedScopes = READ_ONLY;
    expect((await signIn(h, accountId)).status).toBe('connected');
    const after = await google();
    expect(after.account.canEdit).toBe(false);
    expect(after.calendar.agentsEdit).toBe(false);
  });

  it('keeps editing allowed when the user signs in again later', async () => {
    const { accountId, key } = await connected();
    await signIn(h, accountId, key);
    expect((await signIn(h, accountId)).status).toBe('connected');
    const after = await google();
    expect(after.account.canEdit).toBe(true);
    expect(after.calendar.agentsEdit).toBe(true);
  });
});
