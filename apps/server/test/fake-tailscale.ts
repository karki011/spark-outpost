import type { CommandResult, RunCommand } from '../src/setup/command.ts';

export const FAKE_TAILSCALE_HOST = 'spark-mac.tail1234.ts.net';
export const FAKE_TAILSCALE_PATH = '/usr/local/bin/tailscale';

export interface FakeTailscaleState {
  installed: boolean;
  backendState: string;
  hostname: string;
  httpsEnabled: boolean;
  handler: string | null;
  funnel: boolean;
  failServe: boolean;
  calls: string[][];
}

export function fakeTailscaleState(change: Partial<FakeTailscaleState> = {}): FakeTailscaleState {
  return {
    installed: true,
    backendState: 'Running',
    hostname: FAKE_TAILSCALE_HOST,
    httpsEnabled: true,
    handler: null,
    funnel: false,
    failServe: false,
    calls: [],
    ...change,
  };
}

const ok = (stdout = ''): CommandResult => ({ code: 0, stdout, stderr: '' });
const failure = (stderr: string): CommandResult => ({ code: 1, stdout: '', stderr });

function serveConfig(state: FakeTailscaleState): object {
  if (!state.handler) return {};
  const site = `${state.hostname}:443`;
  return {
    TCP: { 443: { HTTPS: true } },
    Web: { [site]: { Handlers: { '/': { Proxy: state.handler } } } },
    ...(state.funnel ? { AllowFunnel: { [site]: true } } : {}),
  };
}

export function fakeTailscaleCommand(state: FakeTailscaleState, args: string[]): CommandResult {
  state.calls.push(args);
  const command = args.join(' ');
  if (command === 'version') return ok('1.80.0\n');
  if (command === 'status --json') {
    return ok(
      JSON.stringify({
        BackendState: state.backendState,
        Self: { DNSName: `${state.hostname}.` },
        CertDomains: state.httpsEnabled ? [state.hostname] : null,
      }),
    );
  }
  if (command === 'serve status --json') return ok(JSON.stringify(serveConfig(state)));
  if (state.failServe) return failure('serve config denied\n');
  if (command === 'serve --https=443 off') {
    state.handler = null;
    return ok();
  }
  const target = /^serve --bg --https=443 (http:\/\/127\.0\.0\.1:\d+)$/.exec(command)?.[1];
  if (!target) return failure(`unknown command: tailscale ${command}\n`);
  state.handler = target;
  return ok();
}

export function fakeTailscaleRunner(state: FakeTailscaleState): RunCommand {
  return async (file, args) => {
    if (file === '/usr/bin/which') {
      return state.installed && args[0] === 'tailscale'
        ? ok(`${FAKE_TAILSCALE_PATH}\n`)
        : failure('');
    }
    if (file !== '/usr/bin/env') return { ...failure(''), code: -1 };
    const [mode, cli, ...rest] = args;
    if (cli !== FAKE_TAILSCALE_PATH || !state.installed) return { ...failure(''), code: -1 };
    if (mode !== 'TAILSCALE_BE_CLI=1') return failure('The Tailscale GUI failed to start\n');
    return fakeTailscaleCommand(state, rest);
  };
}
