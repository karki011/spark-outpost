import type { ReactNode } from 'react';

export const COMPOSER_MAX_ROWS = 5;

export function composerRows(draft: string, maxRows = COMPOSER_MAX_ROWS): number {
  let rows = 1;
  let position = draft.indexOf('\n');
  while (position !== -1 && rows < maxRows) {
    rows += 1;
    position = draft.indexOf('\n', position + 1);
  }
  return rows;
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
