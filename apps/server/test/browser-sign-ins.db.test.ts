import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { savedSignInSchema, signInListSchema } from '@spark-outpost/contracts';
import { storedSecretIds } from '../src/reset/secrets.ts';
import { memorySecretStore, type SecretStore } from '../src/setup/secrets.ts';
import { createTestApp, localClient } from './app-support.ts';
import { linkedConversation } from './approval-support.ts';
import { PLANTED, everyStoredValue, plantedIn } from './sign-in-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let base: string;
let secrets: SecretStore;
let client: ReturnType<typeof localClient>;
let projectId: string;

beforeEach(async () => {
  t = await createTestDb();
  base = realpathSync(mkdtempSync(path.join(tmpdir(), 'spark-sign-ins-')));
  mkdirSync(path.join(base, 'site'));
  secrets = memorySecretStore();
  client = localClient(createTestApp(t, { secrets }));
  projectId = (await linkedConversation(t, path.join(base, 'site'))).projectId;
});

afterEach(async () => {
  rmSync(base, { recursive: true, force: true });
  await t.cleanup();
});

const url = (id = '') => `/api/projects/${projectId}/sign-ins${id ? `/${id}` : ''}`;
const STAGING = { label: 'Staging admin', origin: 'https://staging.example.com/login', ...PLANTED };

async function add(body: object = STAGING) {
  const response = await client.send('post', url(), body);
  expect(response.status).toBe(201);
  return savedSignInSchema.parse(response.body);
}

async function listed() {
  return signInListSchema.parse((await client.get(url())).body).signIns;
}

describe('saved sign-ins of a project', () => {
  it('keeps the username and password in the keychain and only a reference in the database', async () => {
    const saved = await add();
    expect(saved).toMatchObject({
      label: 'Staging admin',
      origin: 'https://staging.example.com',
      username: 'v•••@example.test',
    });
    expect(JSON.stringify(saved)).not.toContain(PLANTED.password);

    const columns = await t.db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'browser_sign_ins'
       ORDER BY ordinal_position`,
    );
    expect(columns.rows.map((row) => row.column_name)).toEqual([
      'id',
      'project_id',
      'label',
      'origin',
      'keychain_ref',
      'created_at',
      'updated_at',
      'sites',
      'refused_site',
    ]);
    expect(plantedIn(await everyStoredValue(t))).toEqual([]);
    expect(JSON.parse((await secrets.get(`signin:${saved.id}`))!)).toEqual(PLANTED);
  });

  it('lists the label, the site and a masked username, never the values', async () => {
    await add();
    const response = await client.get(url());
    expect(plantedIn(JSON.stringify(response.body))).toEqual([]);
    expect((await listed())[0]).toMatchObject({ username: 'v•••@example.test' });
  });

  it('leaves the password alone when an edit sends none', async () => {
    const saved = await add();
    const edited = await client.send('put', url(saved.id), {
      label: 'Staging owner',
      origin: 'staging.example.com',
      username: 'owner@example.test',
    });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ label: 'Staging owner', username: 'o•••@example.test' });
    expect(JSON.parse((await secrets.get(`signin:${saved.id}`))!)).toEqual({
      username: 'owner@example.test',
      password: PLANTED.password,
    });

    await client.send('put', url(saved.id), {
      label: 'Staging owner',
      origin: 'https://staging.example.com',
      password: 'another-Passw0rd',
    });
    expect(JSON.parse((await secrets.get(`signin:${saved.id}`))!)).toEqual({
      username: 'owner@example.test',
      password: 'another-Passw0rd',
    });
  });

  it('removes the keychain entry with the sign-in', async () => {
    const saved = await add();
    expect((await client.send('delete', url(saved.id))).status).toBe(204);
    expect(await listed()).toEqual([]);
    expect(await secrets.get(`signin:${saved.id}`)).toBeNull();
  });

  it('removes the keychain entries when the project is removed', async () => {
    const saved = await add();
    expect((await client.send('delete', `/api/projects/${projectId}`)).status).toBe(200);
    expect(await secrets.get(`signin:${saved.id}`)).toBeNull();
  });

  it('counts sign-ins among the secrets a reset removes', async () => {
    const saved = await add();
    expect(await storedSecretIds(t.db, true)).toContain(`signin:${saved.id}`);
  });

  it.each([
    ['plain http on a public host', 'http://staging.example.com'],
    ['a file', 'file:///tmp/login.html'],
    ['an address with a password in it', 'https://user:pw@staging.example.com'],
    ['words', 'the staging site'],
  ])('refuses %s as the site', async (_name, origin) => {
    const response = await client.send('post', url(), { ...STAGING, origin });
    expect(response.status).toBe(400);
    expect(plantedIn(JSON.stringify(response.body))).toEqual([]);
    expect(await listed()).toEqual([]);
  });

  it.each([
    ['localhost:3000', 'http://localhost:3000'],
    ['http://127.0.0.1:8080/login', 'http://127.0.0.1:8080'],
    ['app.test', 'http://app.test'],
    ['https://shop.localhost:8443', 'https://shop.localhost:8443'],
  ])('accepts the local development host %s', async (typed, origin) => {
    expect((await add({ ...STAGING, origin: typed })).origin).toBe(origin);
  });

  it('refuses a second sign-in with the same label and a short password without echoing them', async () => {
    await add();
    const again = await client.send('post', url(), { ...STAGING, label: 'staging ADMIN' });
    expect(again.status).toBe(400);
    expect(again.body.error).toBe('This project already has a sign-in with that label.');
    const short = await client.send('post', url(), { ...STAGING, label: 'Other', password: 'abc' });
    expect(short.status).toBe(400);
    expect(short.body.error).toBe('Invalid request: password.');
  });

  it('says when a saved sign-in has lost its keychain entry', async () => {
    const saved = await add();
    await secrets.delete(`signin:${saved.id}`);
    expect((await listed())[0]).toMatchObject({ label: 'Staging admin', username: null });
    const edited = await client.send('put', url(saved.id), {
      label: 'Staging admin',
      origin: 'https://staging.example.com',
    });
    expect(edited.status).toBe(400);
    expect(edited.body.error).toContain('missing from the keychain');
  });

  it('keeps other sign-in sites as origins and clears a refused site once it is added', async () => {
    const saved = await add({
      ...STAGING,
      sites: [
        'auth.example.com/u/login',
        'https://example.okta.com',
        'https://staging.example.com',
      ],
    });
    expect(saved.sites).toEqual(['https://auth.example.com', 'https://example.okta.com']);
    const refused = await client.send('post', url(), {
      ...STAGING,
      label: 'Bad',
      sites: ['http://idp.example.com'],
    });
    expect(refused.status).toBe(400);

    await t.db.query(`UPDATE browser_sign_ins SET refused_site = 'https://login.example.net'`);
    expect((await listed())[0]).toMatchObject({ refusedSite: 'https://login.example.net' });
    const kept = await client.send('put', url(saved.id), {
      label: 'Staging owner',
      origin: STAGING.origin,
    });
    expect(kept.body).toMatchObject({
      sites: saved.sites,
      refusedSite: 'https://login.example.net',
    });
    const added = await client.send('put', url(saved.id), {
      label: 'Staging owner',
      origin: STAGING.origin,
      sites: [...saved.sites, 'https://login.example.net'],
    });
    expect(added.body).toMatchObject({
      sites: ['https://auth.example.com', 'https://example.okta.com', 'https://login.example.net'],
      refusedSite: null,
    });
  });
});
