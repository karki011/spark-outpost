import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ATTACHMENT_TEXT_MAX_BYTES,
  PROJECT_FILES_LIMIT,
  type FolderListing,
  type Project,
  type ProjectFilesResponse,
} from '@spark-outpost/contracts';
import { getAttachmentContent } from '../src/persistence/attachments.ts';
import { createTestApp, HOST, ORIGIN } from './app-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let app: ReturnType<typeof createTestApp>;
let base: string;
let root: string;

beforeAll(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'spark-projects-')));
  root = join(base, 'app');
  await mkdir(join(root, 'src', 'api'), { recursive: true });
  await mkdir(join(root, 'node_modules', 'dep'), { recursive: true });
  await mkdir(join(root, '.cache'), { recursive: true });
  await mkdir(join(root, 'Zeta'));
  await writeFile(join(root, 'README.md'), '# App\n');
  await writeFile(join(root, 'src', 'api', 'routes.ts'), 'export const routes = [];\n');
  await writeFile(join(root, 'node_modules', 'dep', 'index.js'), '');
  await writeFile(join(root, '.cache', 'blob.txt'), '');
  await writeFile(join(root, '.env'), 'TOKEN=abc\n');
  await writeFile(join(root, '.env.example'), 'TOKEN=\n');
  await writeFile(join(root, 'logo.bin'), Buffer.from([0xff, 0x00, 0x81]));
  await writeFile(join(root, 'big.txt'), 'a'.repeat(ATTACHMENT_TEXT_MAX_BYTES + 1));
  await writeFile(join(base, 'outside.txt'), 'outside secret\n');
  await symlink(join(base, 'outside.txt'), join(root, 'escape.txt'));
  await symlink(join(root, 'src'), join(root, 'src-link'));
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

beforeEach(async () => {
  t = await createTestDb();
  app = createTestApp(t);
});

afterEach(async () => {
  await t.cleanup();
});

const get = (path: string) => request(app).get(path).set('Host', HOST);
const post = (path: string, body: unknown) =>
  request(app)
    .post(path)
    .set('Host', HOST)
    .set('Origin', ORIGIN)
    .send(body as object);

async function linked(folder = root): Promise<Project> {
  const response = await post('/api/projects', { rootPath: folder }).expect(201);
  return response.body as Project;
}

async function files(projectId: string, query = ''): Promise<ProjectFilesResponse> {
  const response = await get(
    `/api/projects/${projectId}/files?query=${encodeURIComponent(query)}`,
  ).expect(200);
  return response.body as ProjectFilesResponse;
}

const attach = (projectId: string, path: string) =>
  post(`/api/projects/${projectId}/attachments`, { path });

describe('folder picker', () => {
  it('lists visible subfolders, following symlinks, with the parent', async () => {
    const response = await get(`/api/folders?path=${encodeURIComponent(root)}`).expect(200);
    const listing = response.body as FolderListing;
    expect(listing.path).toBe(root);
    expect(listing.parent).toBe(base);
    expect(listing.folders.map((folder) => folder.name)).toEqual([
      'node_modules',
      'src',
      'src-link',
      'Zeta',
    ]);
    expect(listing.folders[1]).toEqual({ name: 'src', path: join(root, 'src') });
  });

  it('defaults to the home folder and reports the root parent as null', async () => {
    const home = (await get('/api/folders').expect(200)).body as FolderListing;
    expect(home.path).toBe(await realpath(homedir()));
    const top = (await get('/api/folders?path=/').expect(200)).body as FolderListing;
    expect(top.parent).toBeNull();
  });

  it('rejects relative, missing, and file paths', async () => {
    const relative = await get('/api/folders?path=src').expect(400);
    expect(relative.body.error).toBe('Choose a folder by its full path.');
    const missing = await get(`/api/folders?path=${encodeURIComponent(join(base, 'nope'))}`);
    expect(missing.status).toBe(400);
    expect(missing.body.error).toBe("That folder doesn't exist.");
    await get(`/api/folders?path=${encodeURIComponent(join(root, 'README.md'))}`).expect(400);
  });
});

describe('projects', () => {
  it('links a folder by its real path and returns the existing project on duplicates', async () => {
    const project = await linked(join(root, 'src', '..'));
    expect(project).toEqual({
      id: expect.any(String),
      name: 'app',
      rootPath: root,
      displayPath: root,
      createdAt: expect.any(String),
      commandAllowlist: [],
      checkCommands: null,
      buildStyle: 'off',
    });
    const again = await post('/api/projects', { rootPath: root }).expect(200);
    expect(again.body).toEqual(project);
    const list = await get('/api/projects').expect(200);
    expect(list.body).toEqual([project]);
  });

  it('refuses the disk root, the home folder, files, and missing folders', async () => {
    for (const rootPath of ['/', homedir()]) {
      const response = await post('/api/projects', { rootPath }).expect(400);
      expect(response.body.error).toBe(
        'Choose a project folder, not your whole disk or home folder.',
      );
    }
    await post('/api/projects', { rootPath: join(root, 'README.md') }).expect(400);
    await post('/api/projects', { rootPath: join(base, 'missing') }).expect(400);
    await post('/api/projects', { rootPath: '' }).expect(400);
  });
});

describe('project files', () => {
  it('walks folders without git, skipping dependencies, dot folders, secrets and escapes', async () => {
    const project = await linked();
    const listed = await files(project.id);
    const paths = listed.files.map((file) => file.path).sort();
    expect(paths).toEqual([
      '.env.example',
      'README.md',
      'big.txt',
      'logo.bin',
      'src/api/routes.ts',
    ]);
    expect(listed.truncated).toBe(false);
    expect(listed.files.find((file) => file.path === 'README.md')?.size).toBe(6);
    const matched = await files(project.id, 'routes');
    expect(matched.files.map((file) => file.path)).toEqual(['src/api/routes.ts']);
  });

  it('uses git when the folder is a repository and caps results', async () => {
    const repo = join(base, 'repo');
    await mkdir(join(repo, 'ignored'), { recursive: true });
    await writeFile(join(repo, '.gitignore'), 'ignored/\n');
    await writeFile(join(repo, 'ignored', 'x.txt'), '');
    await writeFile(join(repo, '.env'), 'X=1');
    for (let index = 0; index < PROJECT_FILES_LIMIT + 5; index++) {
      await writeFile(join(repo, `file-${index}.md`), `${index}`);
    }
    execFileSync('git', ['init', '-q', repo]);
    const project = await linked(repo);
    const all = await files(project.id);
    expect(all.files).toHaveLength(PROJECT_FILES_LIMIT);
    expect(all.truncated).toBe(true);
    const paths = (await files(project.id, 'git')).files.map((file) => file.path);
    expect(paths).toEqual(['.gitignore']);
    expect((await files(project.id, 'env')).files).toEqual([]);
    expect((await files(project.id, 'ignored')).files).toEqual([]);
  });

  it('reports a missing project folder', async () => {
    const gone = join(base, 'gone');
    await mkdir(gone);
    const project = await linked(gone);
    await rm(gone, { recursive: true });
    const response = await get(`/api/projects/${project.id}/files`).expect(400);
    expect(response.body.error).toMatch(/is missing/);
    await get(`/api/projects/${randomUUID()}/files`).expect(404);
  });
});

describe('attaching project files', () => {
  it('stores a text file with its source path', async () => {
    const project = await linked();
    const response = await attach(project.id, 'src/api/routes.ts').expect(201);
    expect(response.body).toEqual({
      id: expect.any(String),
      name: 'routes.ts',
      mediaType: 'text/plain',
      size: 26,
      kind: 'text',
    });
    const stored = await getAttachmentContent(t.db, t.workspaceId, response.body.id as string);
    expect(stored?.data.toString()).toBe('export const routes = [];\n');
    const { rows } = await t.db.query<{ source_path: string }>(
      'SELECT source_path FROM attachments WHERE id = $1',
      [response.body.id],
    );
    expect(rows[0]!.source_path).toBe('src/api/routes.ts');
    await attach(project.id, join(root, 'README.md')).expect(201);
    await attach(project.id, 'src-link/api/routes.ts').expect(201);
  });

  it('refuses secrets, escapes, large, binary and missing files with clear messages', async () => {
    const project = await linked();
    const cases: [string, string][] = [
      ['.env', "Spark Outpost won't attach secret files like .env."],
      ['escape.txt', 'That file is outside the project folder.'],
      ['../outside.txt', 'That file is outside the project folder.'],
      [join(base, 'outside.txt'), 'That file is outside the project folder.'],
      ['big.txt', 'That file is too large. Text files must be 512 KB or smaller.'],
      ['logo.bin', 'Only text files can be attached from a project folder.'],
      ['missing.md', "That file doesn't exist in the project."],
      ['src', 'That path is not a file.'],
    ];
    for (const [path, message] of cases) {
      const response = await attach(project.id, path);
      expect({ path, status: response.status, error: response.body.error }).toEqual({
        path,
        status: 400,
        error: message,
      });
    }
    const { rows } = await t.db.query('SELECT id FROM attachments');
    expect(rows).toHaveLength(0);
  });
});
