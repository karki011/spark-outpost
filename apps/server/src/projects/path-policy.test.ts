import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { projectPolicy, readProjectText, RootMissingError } from './project-fs.ts';
import {
  PathRefusedError,
  isSecretPath,
  parseSparkIgnore,
  refusalFor,
  relativeInside,
  resolveProjectPath,
  sliceLines,
  type PathAccess,
  type PathPolicy,
} from './path-policy.ts';

const missing = (target: string) =>
  Object.assign(new Error(`ENOENT: ${target}`), { code: 'ENOENT' });

function fakePolicy(
  links: Record<string, string>,
  roots: PathPolicy['roots'] = [{ path: '/work/app', ignore: [] }],
): PathPolicy {
  return {
    roots,
    realpath: async (target) => {
      if (target in links) return links[target]!;
      throw missing(target);
    },
  };
}

async function reason(policy: PathPolicy, requested: string, access: PathAccess = 'read') {
  try {
    await resolveProjectPath(policy, requested, access);
    return null;
  } catch (error) {
    if (error instanceof PathRefusedError) return error.reason;
    throw error;
  }
}

describe('secret files', () => {
  it.each([
    '.env',
    '.env.local',
    'config/.env.production',
    'certs/server.pem',
    'tls/site.key',
    'home/.ssh/id_rsa',
    'id_ed25519.pub',
    '.npmrc',
    '.netrc',
    '.aws/credentials',
    'gcloud/credentials.json',
    '.git-credentials',
    'ENV/.ENV',
    'home/.ssh/id_ed25519',
    'id_ecdsa',
    'db/.pgpass',
    '.pypirc',
    'credentials',
    'certs/client.p12',
    'certs/client.PFX',
    '.env.example.local',
  ])('refuses %s', (file) => {
    expect(isSecretPath(file)).toBe(true);
  });

  it.each([
    '.env.example',
    'src/env.ts',
    'README.md',
    'docs/keys.md',
    'keyboard.ts',
    'identity.ts',
    'src/id_utils.ts',
    'id_rsa_notes.md',
    'credentialsHelper.ts',
  ])('allows %s', (file) => {
    expect(isSecretPath(file)).toBe(false);
  });

  it('honours .sparkignore names, globs, anchored paths and directories', () => {
    const ignore = parseSparkIgnore('# comment\n\nsecrets/\n*.sqlite\n/config/prod.json\n!keep\n');
    expect(ignore).toEqual(['secrets/', '*.sqlite', '/config/prod.json']);
    expect(isSecretPath('secrets/token.txt', ignore)).toBe(true);
    expect(isSecretPath('nested/secrets/a/b.txt', ignore)).toBe(true);
    expect(isSecretPath('data/app.sqlite', ignore)).toBe(true);
    expect(isSecretPath('config/prod.json', ignore)).toBe(true);
    expect(isSecretPath('other/config/prod.json', ignore)).toBe(false);
    expect(isSecretPath('src/secrets.ts', ignore)).toBe(false);
    expect(isSecretPath('keep', ignore)).toBe(false);
  });

  it('supports ** in .sparkignore patterns', () => {
    expect(isSecretPath('a/b/private/x.txt', ['a/**/private'])).toBe(true);
    expect(isSecretPath('a/private/x.txt', ['a/**/private'])).toBe(true);
    expect(isSecretPath('b/private/x.txt', ['a/**/private'])).toBe(false);
  });
});

describe('containment', () => {
  it('only accepts paths strictly inside the root', () => {
    expect(relativeInside('/work/app', '/work/app/src/a.ts')).toBe('src/a.ts');
    expect(relativeInside('/work/app', '/work/app')).toBeNull();
    expect(relativeInside('/work/app', '/work/application/a.ts')).toBeNull();
    expect(relativeInside('/work/app', '/work/x')).toBeNull();
    expect(relativeInside('/work/app', '/work/app/..foo')).toBe('..foo');
  });

  it('refuses writes under .git but allows reading it', () => {
    expect(refusalFor('.git/config', 'write', [])).toBe('inside .git');
    expect(refusalFor('.git/HEAD', 'read', [])).toBeNull();
    expect(refusalFor('src/.gitkeep', 'write', [])).toBeNull();
  });
});

describe('resolveProjectPath with a fake filesystem', () => {
  const policy = fakePolicy({
    '/work/app/README.md': '/work/app/README.md',
    '/work/app/src': '/work/app/src',
    '/work/app/link-out': '/etc/passwd',
    '/work/app/notes.txt': '/work/app/.env',
    '/work/app/.git': '/work/app/.git',
  });

  it('resolves files inside the root to absolute and relative paths', async () => {
    await expect(resolveProjectPath(policy, '/work/app/README.md', 'read')).resolves.toEqual({
      root: '/work/app',
      absolute: '/work/app/README.md',
      relative: 'README.md',
    });
  });

  it('refuses relative paths', async () => {
    expect(await reason(policy, 'README.md')).toBe('not absolute');
  });

  it('refuses .. escapes before touching the disk', async () => {
    expect(await reason(policy, '/work/app/../other/x')).toBe('outside the project');
    expect(await reason(policy, '/work/app/src/../../../etc/passwd')).toBe('outside the project');
  });

  it('refuses symlinks that escape the root or point at secrets', async () => {
    expect(await reason(policy, '/work/app/link-out')).toBe('outside the project');
    expect(await reason(policy, '/work/app/notes.txt')).toBe('secret file');
  });

  it('refuses secret names even when they do not exist', async () => {
    expect(await reason(policy, '/work/app/.env')).toBe('secret file');
  });

  it('reports missing files for reads instead of refusing them', async () => {
    await expect(resolveProjectPath(policy, '/work/app/nope.txt', 'read')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('resolves new files for writes through their nearest existing parent', async () => {
    await expect(resolveProjectPath(policy, '/work/app/src/new/a.ts', 'write')).resolves.toEqual({
      root: '/work/app',
      absolute: '/work/app/src/new/a.ts',
      relative: 'src/new/a.ts',
    });
    expect(await reason(policy, '/work/app/.git/hooks/pre-commit', 'write')).toBe('inside .git');
  });
});

describe('resolveProjectPath across several roots', () => {
  const roots = [
    { path: '/work/app', ignore: [] },
    { path: '/work/lib', ignore: ['generated/'] },
    { path: '/work/app/vendor/kit', ignore: [] },
  ];
  const policy = fakePolicy(
    {
      '/work/app/README.md': '/work/app/README.md',
      '/work/lib/src/index.ts': '/work/lib/src/index.ts',
      '/work/lib/generated/api.ts': '/work/lib/generated/api.ts',
      '/work/app/lib-link.ts': '/work/lib/src/index.ts',
      '/work/app/vendor/kit/a.ts': '/work/app/vendor/kit/a.ts',
      '/work/lib/escape': '/work/other/x.ts',
    },
    roots,
  );

  it('reads from any linked root and reports which root it came from', async () => {
    await expect(resolveProjectPath(policy, '/work/lib/src/index.ts', 'read')).resolves.toEqual({
      root: '/work/lib',
      absolute: '/work/lib/src/index.ts',
      relative: 'src/index.ts',
    });
    await expect(resolveProjectPath(policy, '/work/app/README.md', 'read')).resolves.toMatchObject({
      root: '/work/app',
    });
  });

  it('follows symlinks from one linked root into another', async () => {
    await expect(resolveProjectPath(policy, '/work/app/lib-link.ts', 'read')).resolves.toEqual({
      root: '/work/lib',
      absolute: '/work/lib/src/index.ts',
      relative: 'src/index.ts',
    });
  });

  it('uses the closest root for nested folders', async () => {
    await expect(
      resolveProjectPath(policy, '/work/app/vendor/kit/a.ts', 'read'),
    ).resolves.toMatchObject({ root: '/work/app/vendor/kit', relative: 'a.ts' });
  });

  it("applies each root's own ignore rules and still refuses paths outside every root", async () => {
    expect(await reason(policy, '/work/lib/generated/api.ts')).toBe('secret file');
    expect(await reason(policy, '/work/lib/.env')).toBe('secret file');
    expect(await reason(policy, '/work/other/x.ts')).toBe('outside the project');
    expect(await reason(policy, '/work/lib/escape')).toBe('outside the project');
    expect(await reason(policy, '/work/lib/../other/x.ts')).toBe('outside the project');
  });

  it('refuses the root folders themselves', async () => {
    expect(await reason(policy, '/work/lib')).toBe('outside the project');
  });
});

describe('resolveProjectPath on a real directory', () => {
  let base: string;
  let root: string;
  let policy: PathPolicy;

  beforeAll(async () => {
    base = await realpath(await mkdtemp(join(tmpdir(), 'spark-policy-')));
    root = join(base, 'project');
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src', 'a.ts'), 'export {}');
    await writeFile(join(base, 'outside.txt'), 'secret');
    await symlink(join(base, 'outside.txt'), join(root, 'escape.txt'));
    await symlink(base, join(root, 'up'));
    await symlink(join(root, 'src'), join(root, 'alias'));
    policy = { roots: [{ path: root, ignore: [] }], realpath };
  });

  afterAll(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('follows symlinks that stay inside the root', async () => {
    await expect(resolveProjectPath(policy, join(root, 'alias', 'a.ts'), 'read')).resolves.toEqual({
      root,
      absolute: join(root, 'src', 'a.ts'),
      relative: 'src/a.ts',
    });
  });

  it('refuses file and directory symlinks that escape the root', async () => {
    expect(await reason(policy, join(root, 'escape.txt'))).toBe('outside the project');
    expect(await reason(policy, join(root, 'up', 'outside.txt'))).toBe('outside the project');
    expect(await reason(policy, join(root, 'up', 'new.txt'), 'write')).toBe('outside the project');
  });
});

describe('project policy with several real roots', () => {
  let base: string;

  beforeAll(async () => {
    base = await realpath(await mkdtemp(join(tmpdir(), 'spark-roots-')));
    await mkdir(join(base, 'app'));
    await mkdir(join(base, 'lib'));
    await writeFile(join(base, 'app', 'README.md'), 'app readme');
    await writeFile(join(base, 'lib', 'README.md'), 'lib readme');
    await writeFile(join(base, 'lib', '.sparkignore'), 'private/\n');
  });

  afterAll(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('resolves relative paths against the primary root and absolute ones in any root', async () => {
    const policy = await projectPolicy([join(base, 'app'), join(base, 'lib')]);
    expect(policy.roots.map((root) => root.ignore)).toEqual([[], ['private/']]);
    expect((await readProjectText(policy, 'README.md')).content).toBe('app readme');
    const lib = await readProjectText(policy, join(base, 'lib', 'README.md'));
    expect(lib).toMatchObject({ root: join(base, 'lib'), content: 'lib readme' });
  });

  it('names the missing root', async () => {
    const opening = projectPolicy([join(base, 'app'), join(base, 'gone')]);
    await expect(opening).rejects.toBeInstanceOf(RootMissingError);
    await expect(opening).rejects.toMatchObject({ root: join(base, 'gone') });
  });
});

describe('sliceLines', () => {
  const text = 'one\ntwo\nthree\nfour';

  it('returns everything without line or limit', () => {
    expect(sliceLines(text)).toBe(text);
    expect(sliceLines(text, null, null)).toBe(text);
  });

  it('starts at a 1-based line and honours the limit', () => {
    expect(sliceLines(text, 2)).toBe('two\nthree\nfour');
    expect(sliceLines(text, 2, 2)).toBe('two\nthree');
    expect(sliceLines(text, null, 1)).toBe('one');
    expect(sliceLines(text, 9, 2)).toBe('');
  });
});
