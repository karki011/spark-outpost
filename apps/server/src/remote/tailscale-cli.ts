import { z } from 'zod';
import type { CommandResult, RunCommand } from '../setup/command.ts';
import { locateCli } from '../setup/verify.ts';

export const TAILSCALE_APP_CLI = '/Applications/Tailscale.app/Contents/MacOS/Tailscale';
export const SERVE_HTTPS_PORT = 443;
const COMMAND_TIMEOUT_MS = 10_000;
const ENV = '/usr/bin/env';
const CLI_MODE = 'TAILSCALE_BE_CLI=1';

const statusSchema = z.object({
  BackendState: z.string(),
  Self: z.object({ DNSName: z.string().optional() }).nullish(),
  CertDomains: z.array(z.string()).nullish(),
});

const serveSchema = z.object({
  Web: z
    .record(
      z.string(),
      z.object({
        Handlers: z.record(z.string(), z.object({ Proxy: z.string().optional() })).nullish(),
      }),
    )
    .nullish(),
  AllowFunnel: z.record(z.string(), z.boolean()).nullish(),
});

export type TailscaleReading =
  | { kind: 'not_installed' }
  | { kind: 'signed_out' }
  | { kind: 'https_off'; hostname: string }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; hostname: string; handler: string | null; funnel: boolean };

export interface TailscaleCli {
  read(): Promise<TailscaleReading>;
  serve(target: string): Promise<string | null>;
  stopServing(): Promise<string | null>;
}

const NOT_ANSWERING =
  'Tailscale is not running or did not answer. Open Tailscale on this Mac, then try again.';
const NOT_INSTALLED = 'Tailscale is not installed on this Mac.';
const TIMED_OUT = 'Tailscale took too long to answer. Open Tailscale on this Mac, then try again.';
const SERVE_UNREADABLE = 'Tailscale is running, but Spark could not read its Serve settings.';

function parsed<T>(schema: z.ZodType<T>, stdout: string): T | null {
  try {
    const result = schema.safeParse(JSON.parse(stdout.trim() || '{}'));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function unanswered(result: CommandResult, fallback: string): string {
  if (result.timedOut) return TIMED_OUT;
  const said = firstLine(result.stderr) || (result.code === 0 ? '' : firstLine(result.stdout));
  return said ? `${fallback} Tailscale said: ${said}` : fallback;
}

function firstLine(text: string): string {
  return (
    text
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0)
      ?.slice(0, 300) ?? ''
  );
}

export function tailscaleCli(launch: RunCommand, shell: string | null): TailscaleCli {
  let found: string | null = null;
  const run: RunCommand = (file, args, timeoutMs) =>
    launch(ENV, [CLI_MODE, file, ...args], timeoutMs);

  const locate = async (): Promise<string | null> => {
    if (found) return found;
    const candidates = [await locateCli('tailscale', launch, shell), TAILSCALE_APP_CLI];
    for (const candidate of candidates) {
      if (!candidate) continue;
      const version = await run(candidate, ['version'], COMMAND_TIMEOUT_MS);
      if (version.code === 0) {
        found = candidate;
        return candidate;
      }
    }
    return null;
  };

  const change = async (args: string[], failure: string): Promise<string | null> => {
    const cli = await locate();
    if (!cli) return NOT_INSTALLED;
    const result = await run(cli, args, COMMAND_TIMEOUT_MS);
    if (result.code === 0) return null;
    const said = firstLine(result.stderr) || firstLine(result.stdout);
    return said ? `${failure} Tailscale said: ${said}` : failure;
  };

  return {
    async read() {
      const cli = await locate();
      if (!cli) return { kind: 'not_installed' };
      const status = await run(cli, ['status', '--json'], COMMAND_TIMEOUT_MS);
      const state = status.code === 0 ? parsed(statusSchema, status.stdout) : null;
      if (!state) return { kind: 'error', message: unanswered(status, NOT_ANSWERING) };
      if (state.BackendState !== 'Running') return { kind: 'signed_out' };
      const hostname = (state.Self?.DNSName ?? '').replace(/\.$/, '').toLowerCase();
      if (!hostname) return { kind: 'signed_out' };
      if (!state.CertDomains?.length) return { kind: 'https_off', hostname };
      const serving = await run(cli, ['serve', 'status', '--json'], COMMAND_TIMEOUT_MS);
      const config = serving.code === 0 ? parsed(serveSchema, serving.stdout) : null;
      if (!config) return { kind: 'error', message: unanswered(serving, SERVE_UNREADABLE) };
      const site = `${hostname}:${SERVE_HTTPS_PORT}`;
      return {
        kind: 'ready',
        hostname,
        handler: config.Web?.[site]?.Handlers?.['/']?.Proxy ?? null,
        funnel: config.AllowFunnel?.[site] === true,
      };
    },

    serve: (target) =>
      change(
        ['serve', '--bg', `--https=${SERVE_HTTPS_PORT}`, target],
        'Tailscale Serve could not be turned on.',
      ),

    stopServing: () =>
      change(
        ['serve', `--https=${SERVE_HTTPS_PORT}`, 'off'],
        'Tailscale Serve could not be turned off.',
      ),
  };
}
