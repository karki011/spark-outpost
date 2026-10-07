import type { ProtocolObserver, ProviderOutput } from '../providers/provider.ts';
import { auditContinuedSession } from './continue-note.ts';
import type { RunInput } from './run-input.ts';
import type { TurnSession } from './turn-session.ts';

export interface SessionObserver {
  audit: ProtocolObserver;
  input: RunInput;
  session: TurnSession | null;
}

export async function observeSession(
  { audit, input, session }: SessionObserver,
  output: ProviderOutput,
): Promise<void> {
  if (output.kind === 'session') {
    await session?.started(output);
    auditContinuedSession(audit, input, session?.target, output);
  }
  if (output.kind === 'commands') await session?.commands(output.commands);
  if (output.kind === 'session_settings') await session?.settings(output);
}
