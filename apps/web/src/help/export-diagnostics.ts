import { DIAGNOSTICS_EXPORT_PATH, diagnosticsFileName } from '@spark-outpost/contracts';
import { sparkDesktop } from '../desktop/desktop-bridge.ts';
import { saveResponse } from '../ui/save-response.ts';

export type DiagnosticsOutcome =
  { kind: 'saved'; path: string } | { kind: 'downloaded'; name: string } | { kind: 'cancelled' };

async function download(): Promise<DiagnosticsOutcome> {
  const response = await fetch(DIAGNOSTICS_EXPORT_PATH);
  if (!response.ok) throw new Error(`Spark couldn't collect diagnostics (${response.status}).`);
  const name = await saveResponse(response, diagnosticsFileName(new Date()));
  return { kind: 'downloaded', name };
}

export async function exportDiagnostics(): Promise<DiagnosticsOutcome> {
  const help = sparkDesktop()?.help;
  if (!help) return download();
  const result = await help.exportDiagnostics();
  return result?.saved ? { kind: 'saved', path: result.path } : { kind: 'cancelled' };
}

export function outcomeText(outcome: DiagnosticsOutcome): string {
  switch (outcome.kind) {
    case 'saved':
      return `Saved to ${outcome.path}.`;
    case 'downloaded':
      return `Downloaded ${outcome.name} to your downloads folder.`;
    case 'cancelled':
      return 'Not saved.';
  }
}
