import {
  nativeTerminalProviderSchema,
  terminalProviderName,
  type NativeTerminalProvider,
  type TerminalAgent,
} from '@spark-outpost/contracts';

export type TerminalCliLocator = (cli: NativeTerminalProvider) => Promise<string | null>;

export async function terminalAgents(locate: TerminalCliLocator): Promise<TerminalAgent[]> {
  return Promise.all(
    nativeTerminalProviderSchema.options.map(async (id) => ({
      id,
      name: terminalProviderName(id),
      installed: (await locate(id).catch(() => null)) !== null,
    })),
  );
}
