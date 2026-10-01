import { DIAGNOSTICS_EXPORT_PATH, diagnosticsFileName } from '@spark-outpost/contracts';
import { sparkDesktop } from '../desktop/desktop-bridge.ts';

export type DiagnosticsOutcome =
  { kind: 'saved'; path: string } | { kind: 'downloaded'; name: string } | { kind: 'cancelled' };

function attachmentName(header: string | null): string {
  const match = /filename="([^"]+)"/.exec(header ?? '');
  return match?.[1] ?? diagnosticsFileName(new Date());
}

async function download(): Promise<DiagnosticsOutcome> {
  const response = await fetch(DIAGNOSTICS_EXPORT_PATH);
  if (!response.ok) throw new Error(`Spark couldn't collect diagnostics (${response.status}).`);
  const name = attachmentName(response.headers.get('Content-Disposition'));
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
