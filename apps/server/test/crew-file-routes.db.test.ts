import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  crewFileSchema,
  sparkFolderSchema,
  type CrewFile,
  type Teammate,
  type TeammateChat,
} from '@spark-outpost/contracts';
import { crewSparksDir, sparkFolderPath } from '../src/crew/folders.ts';
import { crewFileHash } from '../src/crew/spark-folder.ts';
import { ROUTE_RULES } from '../src/remote/route-rules.ts';
import { createTestApp, localClient } from './app-support.ts';
import { pairDevice, remoteClient, turnRemoteOn } from './remote-support.ts';
import { connectCliProvider, createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let app: ReturnType<typeof createTestApp>;
let client: ReturnType<typeof localClient>;
let spark: Teammate;

beforeEach(async () => {
  t = await createTestDb();
  app = createTestApp(t);
  client = localClient(app);
  await connectCliProvider(t, 'claude');
  const created = await client.send('post', '/api/teammates', { name: 'Pip' });
  spark = created.body as Teammate;
});

afterEach(async () => {
  await client.send('delete', `/api/teammates/${spark.id}`);
  await t.cleanup();
});

const filesUrl = (id = spark.id) => `/api/teammates/${id}/files`;
const fileUrl = (file: string, id = spark.id) => `${filesUrl(id)}?path=${encodeURIComponent(file)}`;
const save = (file: string, text: string, baseHash: string | null = null, id = spark.id) =>
  client.send('put', filesUrl(id), { path: file, text, baseHash });
const folderOnDisk = (id = spark.id) => sparkFolderPath(crewSparksDir(), id);
const SKILL = '---\nname: review\ndescription: Review a diff\n---\nSteps.\n';

describe('GET /api/teammates/:id/folder', () => {
  it('returns an empty folder for a new Spark', async () => {
    const response = await client.get(`/api/teammates/${spark.id}/folder`);
    expect(response.status).toBe(200);
    expect(sparkFolderSchema.parse(response.body)).toEqual({
      sparkId: spark.id,
      files: [],
      skills: [],
      problems: [],
    });
  });

  it('lists files, skills and skill problems', async () => {
    await save('SPARK.md', 'Be brief.');
    await save('skills/review/SKILL.md', SKILL);
    await save('skills/review/check.sh', 'echo ok\n');
    await save('skills/broken/SKILL.md', 'no frontmatter');
    const folder = sparkFolderSchema.parse(
      (await client.get(`/api/teammates/${spark.id}/folder`)).body,
    );
    expect(folder.files.map((file) => file.path)).toEqual([
      'SPARK.md',
      'skills/broken/SKILL.md',
      'skills/review/SKILL.md',
      'skills/review/check.sh',
    ]);
    expect(folder.skills).toEqual([{ name: 'review', description: 'Review a diff' }]);
    expect(folder.problems.map((problem) => problem.path)).toEqual(['skills/broken/SKILL.md']);
  });
});

describe('PUT, GET and DELETE /api/teammates/:id/files', () => {
  it('creates, reads, saves over and deletes a file', async () => {
    const created = await save('skills/review/SKILL.md', SKILL);
    expect(created.status).toBe(200);
    const file = crewFileSchema.parse(created.body);
    expect(file).toEqual({
      path: 'skills/review/SKILL.md',
      text: SKILL,
      hash: crewFileHash(SKILL),
    });

    const read = await client.get(fileUrl('skills/review/SKILL.md'));
    expect(read.status).toBe(200);
    expect(read.body).toEqual(file);

    const changed = await save('skills/review/SKILL.md', `${SKILL}More.\n`, file.hash);
    expect(changed.status).toBe(200);
    expect((changed.body as CrewFile).hash).not.toBe(file.hash);

    const removed = await client.send('delete', fileUrl('skills/review/SKILL.md'));
    expect(removed.status).toBe(204);
    expect((await client.get(fileUrl('skills/review/SKILL.md'))).status).toBe(404);
    expect((await client.send('delete', fileUrl('skills/review/SKILL.md'))).status).toBe(404);
  });

  it('answers 409 when the file already exists or changed since the base hash', async () => {
    const first = (await save('notes.md', 'one')).body as CrewFile;
    const again = await save('notes.md', 'two');
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('A file with this name already exists.');

    expect((await save('notes.md', 'two', first.hash)).status).toBe(200);
    const stale = await save('notes.md', 'three', first.hash);
    expect(stale.status).toBe(409);
    expect(stale.body.error).toContain('changed since you opened it');
    expect(((await client.get(fileUrl('notes.md'))).body as CrewFile).text).toBe('two');
  });

  it('gives the same answer to a repeated create', async () => {
    const [one, two] = await Promise.all([save('a.md', 'same'), save('a.md', 'same')]);
    expect([one.status, two.status].sort()).toEqual([200, 409]);
  });

  it.each(['../escape.md', '/etc/passwd', 'a/../../b.md', '.env', 'a\\b.md'])(
    'refuses the path %j with 400',
    async (bad) => {
      expect((await save(bad, 'x')).status).toBe(400);
      expect((await client.get(fileUrl(bad))).status).toBe(400);
      expect((await client.send('delete', fileUrl(bad))).status).toBe(400);
    },
  );

  it('validates the request at the boundary', async () => {
    expect((await client.get(filesUrl())).status).toBe(400);
    expect((await client.send('delete', filesUrl())).status).toBe(400);
    expect((await client.send('put', filesUrl(), { path: 'a.md' })).status).toBe(400);
    expect(
      (await client.send('put', filesUrl(), { path: 'a.md', text: 1, baseHash: null })).status,
    ).toBe(400);
    expect((await client.get('/api/teammates/not-a-uuid/folder')).status).toBe(400);
    const unknown = randomUUID();
    expect((await client.get(`/api/teammates/${unknown}/folder`)).status).toBe(404);
    expect((await client.get(fileUrl('a.md', unknown))).status).toBe(404);
    expect((await save('a.md', 'x', null, unknown)).status).toBe(404);
    expect((await client.send('delete', fileUrl('a.md', unknown))).status).toBe(404);
    await expect(stat(folderOnDisk(unknown))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('accepts a file near the size limit and refuses one over it', async () => {
    const escaped = '"\n'.repeat(100_000);
    expect((await save('big.md', escaped)).status).toBe(200);
    const over = await save('huge.md', 'a'.repeat(256 * 1024 + 1));
    expect(over.status).toBe(400);
    expect(over.body.error).toContain('256 KB');
    expect((await save('nul.md', 'a\u0000b')).status).toBe(400);
  });
});

describe('instructions are the SPARK.md file', () => {
  it('shows the typed instructions as SPARK.md and the file as the instructions', async () => {
    await client.send('patch', `/api/teammates/${spark.id}`, { instructions: 'Be brief.' });
    const file = (await client.get(fileUrl('SPARK.md'))).body as CrewFile;
    expect(file.text).toBe('Be brief.');
    expect(await readFile(path.join(folderOnDisk(), 'SPARK.md'), 'utf8')).toBe('Be brief.');

    const long = 'Check every changed line.\n'.repeat(500).trim();
    expect((await save('SPARK.md', long, file.hash)).status).toBe(200);
    const listed = (await client.get('/api/teammates')).body as { teammates: Teammate[] };
    expect(listed.teammates[0]!.instructions).toBe(long);
    const { rows } = await t.db.query<{ instructions: string }>(
      'SELECT instructions FROM teammates WHERE id = $1',
      [spark.id],
    );
    expect(rows[0]!.instructions).toBe('');
  });
});

describe('editing files and deleting the Spark', () => {
  async function openSession(): Promise<string> {
    const home = await client.send('post', `/api/teammates/${spark.id}/home`, {});
    const { conversationId } = home.body as TeammateChat;
    const sessionId = randomUUID();
    await t.db.query(
      `INSERT INTO provider_sessions
         (id, conversation_id, provider, agent_key, session_id, cwd, settings_hash)
       VALUES ($1, $2, 'claude', 'chat:chat', $3, '/work', 'h')`,
      [randomUUID(), conversationId, sessionId],
    );
    return sessionId;
  }

  async function closed(sessionId: string): Promise<boolean> {
    const { rows } = await t.db.query<{ closed: boolean }>(
      'SELECT closed_at IS NOT NULL AS closed FROM provider_sessions WHERE session_id = $1',
      [sessionId],
    );
    return rows[0]!.closed;
  }

  it('closes the Spark’s chat sessions when a file is saved or deleted', async () => {
    const first = await openSession();
    await save('skills/review/SKILL.md', SKILL);
    expect(await closed(first)).toBe(true);
    const second = await openSession();
    expect(await closed(second)).toBe(false);
    await client.send('delete', fileUrl('skills/review/SKILL.md'));
    expect(await closed(second)).toBe(true);
  });

  it('leaves sessions open when a save is refused', async () => {
    await save('notes.md', 'one');
    const session = await openSession();
    expect((await save('notes.md', 'two')).status).toBe(409);
    expect(await closed(session)).toBe(false);
  });

  it('deletes the folder with the Spark', async () => {
    await save('skills/review/SKILL.md', SKILL);
    expect((await stat(folderOnDisk())).isDirectory()).toBe(true);
    expect((await client.send('delete', `/api/teammates/${spark.id}`)).status).toBe(204);
    await expect(stat(folderOnDisk())).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await client.get(`/api/teammates/${spark.id}/folder`)).status).toBe(404);
  });
});

describe('paired devices', () => {
  const ROUTES = [
    'GET /api/teammates/:id/folder',
    'GET /api/teammates/:id/files',
    'PUT /api/teammates/:id/files',
    'DELETE /api/teammates/:id/files',
  ];

  it('classifies every file route as Mac only', () => {
    expect(ROUTES.map((route) => ROUTE_RULES.get(route))).toEqual(ROUTES.map(() => 'never'));
  });

  it('refuses a paired device on every file route and changes nothing', async () => {
    await save('notes.md', 'one');
    await turnRemoteOn(app);
    const phone = remoteClient(app, (await pairDevice(app)).cookie);
    expect((await phone.get('/api/teammates')).status).toBe(200);
    expect((await phone.get(`/api/teammates/${spark.id}/folder`)).status).toBe(403);
    expect((await phone.get(fileUrl('notes.md'))).status).toBe(403);
    const put = await phone.send('put', filesUrl(), { path: 'new.md', text: 'x', baseHash: null });
    expect(put.status).toBe(403);
    expect((await phone.send('delete', fileUrl('notes.md'))).status).toBe(403);
    const folder = sparkFolderSchema.parse(
      (await client.get(`/api/teammates/${spark.id}/folder`)).body,
    );
    expect(folder.files.map((file) => file.path)).toEqual(['notes.md']);
  });
});
