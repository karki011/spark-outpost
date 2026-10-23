export const DIAGNOSTICS_EXPORT_PATH = '/api/diagnostics/export';
export const FEEDBACK_SETTINGS_FOCUS = 'send-feedback';

export interface DesktopHelpInfo {
  version: string;
  beta: boolean;
  logsFolder: string;
}

export type DiagnosticsExport = { saved: true; path: string } | { saved: false };

export function diagnosticsFileName(now: Date): string {
  const stamp = now.toISOString().slice(0, 19).replace('T', '-').replaceAll(':', '');
  return `spark-outpost-diagnostics-${stamp}.zip`;
}
