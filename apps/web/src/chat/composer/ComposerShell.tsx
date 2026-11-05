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
  children: ReactNode;
  bar: ReactNode;
  foot?: ReactNode;
}

export function ComposerShell({
  error,
  warning,
  above = null,
  children,
  bar,
  foot = null,
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
      <div className="composer-frame">
        <div className="composer">
          {children}
          <div className="comp-bar">{bar}</div>
        </div>
        {foot && (
          <div className="comp-foot" role="group" aria-label="Chat settings">
            {foot}
          </div>
        )}
      </div>
    </div>
  );
}
