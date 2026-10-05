import { spawn } from 'node:child_process';
import { childEnvironment } from '../../setup/environment.ts';

const OUTPUT_TAIL_CHARS = 8_000;
const KILL_GRACE_MS = 3_000;
const INHERITED_GIT_STATE = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_TEMPLATE_DIR',
  'GIT_CONFIG_PARAMETERS',
];

export interface GitCloneRequest {
  gitPath: string;
  url: string;
  destination: string;
  env: Record<string, string>;
  config: readonly string[];
  onLine: (line: string) => void;
}

export interface GitCloneResult {
  code: number;
  output: string;
}

export interface GitCloneProcess {
  pid: number | null;
  done: Promise<GitCloneResult>;
  stop(): void;
}

export function cloneEnvironment(
  base: NodeJS.ProcessEnv,
  options: { allowFileProtocol: boolean },
): Record<string, string> {
  const env = childEnvironment(base);
  for (const name of INHERITED_GIT_STATE) delete env[name];
  return {
    ...env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: '',
    SSH_ASKPASS: '',
    SSH_ASKPASS_REQUIRE: 'never',
    GIT_ALLOW_PROTOCOL: options.allowFileProtocol ? 'https:ssh:file' : 'https:ssh',
    LC_ALL: 'C',
  };
}

export function cloneArguments(request: Pick<GitCloneRequest, 'url' | 'destination' | 'config'>) {
  return [
    ...request.config,
    '-c',
    'core.hooksPath=/dev/null',
    '-c',
    'submodule.recurse=false',
    'clone',
    '--progress',
    '--no-recurse-submodules',
    '--',
    request.url,
    request.destination,
  ];
}

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    return;
  }
}

export function startGitClone(request: GitCloneRequest): GitCloneProcess {
  const child = spawn(request.gitPath, cloneArguments(request), {
    env: request.env,
    stdio: ['ignore', 'ignore', 'pipe'],
    detached: true,
  });
  let output = '';
  let pending = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    output = `${output}${chunk}`.slice(-OUTPUT_TAIL_CHARS);
    const lines = `${pending}${chunk}`.split(/[\r\n]/);
    pending = lines.pop() ?? '';
    for (const line of lines) request.onLine(line);
  });
  let forced: ReturnType<typeof setTimeout> | null = null;
  const done = new Promise<GitCloneResult>((resolve) => {
    const finish = (code: number, extra = '') => {
      if (forced) clearTimeout(forced);
      resolve({ code, output: `${output}${extra}` });
    };
    child.once('error', (error) => finish(-1, `\n${error.message}`));
    child.once('close', (code) => finish(code ?? -1));
  });
  return {
    pid: child.pid ?? null,
    done,
    stop() {
      const pid = child.pid;
      if (!pid || child.exitCode !== null || child.signalCode !== null) return;
      signalGroup(pid, 'SIGTERM');
      forced ??= setTimeout(() => signalGroup(pid, 'SIGKILL'), KILL_GRACE_MS);
    },
  };
}
