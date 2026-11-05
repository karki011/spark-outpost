import { ProviderError } from '../../providers/provider.ts';
import { runCommand } from '../../setup/command.ts';
import { cliLogin, locateCli } from '../../setup/verify.ts';

export type AgentCli = 'claude' | 'codex';

export type CliLocator = (cli: AgentCli) => Promise<string | null>;

const EXECUTABLE_ENV: Record<AgentCli, string> = {
  claude: 'CLAUDE_CODE_EXECUTABLE',
  codex: 'CODEX_PATH',
};

export function loginShellLocator(shell: string | null): (cli: string) => Promise<string | null> {
  return (cli) => locateCli(cli, runCommand, shell);
}

const defaultLocator = loginShellLocator(process.env.SHELL || '/bin/zsh');

export async function cliEnvironment(
  definition: { name: string; cli: AgentCli },
  locate: CliLocator = defaultLocator,
): Promise<Record<string, string>> {
  const path = await locate(definition.cli);
  if (!path) {
    throw new ProviderError(
      `${definition.name} runs through the \`${definition.cli}\` CLI, which isn't installed or isn't on your PATH. Install it in Settings → AI providers, then try again.`,
    );
  }
  return { [EXECUTABLE_ENV[definition.cli]]: path };
}

export async function cliSignedIn(
  cli: AgentCli,
  locate: CliLocator = defaultLocator,
): Promise<boolean | null> {
  const path = await locate(cli);
  if (!path) return null;
  return (await cliLogin(cli, path, runCommand))?.signedIn ?? null;
}
