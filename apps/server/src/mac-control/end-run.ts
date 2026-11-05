import type { MacHost } from './host-client.ts';

export async function endMacRun(
  mac: MacHost | undefined,
  chatId: string | null,
  runId: string | null,
): Promise<void> {
  if (!mac || !chatId) return;
  await mac.request({ op: 'end_run', chatId, runId }).catch(() => undefined);
}
