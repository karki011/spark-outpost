import type { ReactNode } from 'react';

export const COMPOSER_MAX_ROWS = 5;

export function composerRows(draft: string): number {
  return Math.min(COMPOSER_MAX_ROWS, Math.max(1, draft.split('\n').length));
}

interface ComposerShellProps {
  error: string | null;
  warning: ReactNode;
  above?: ReactNode;
  lead?: ReactNode;
  children: ReactNode;
  bar: ReactNode;
}

export function ComposerShell({
  error,
  warning,
  above = null,
  lead = null,
  children,
  bar,
}: ComposerShellProps) {
  return (
    <div className="composer-wrap">
      {error && (
        <p className="composer-error" role="alert">
          {error}
        </p>
      )}
      {warning}
      {above}
      {lead && <div className="composer-lead">{lead}</div>}
      <div className="composer">
        {children}
        <div className="comp-bar">{bar}</div>
      </div>
    </div>
  );
}
