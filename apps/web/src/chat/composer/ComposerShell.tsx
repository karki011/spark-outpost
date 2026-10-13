import type { ReactNode } from 'react';

export const COMPOSER_MAX_ROWS = 5;

export function composerRows(draft: string): number {
  return Math.min(COMPOSER_MAX_ROWS, Math.max(1, draft.split('\n').length));
}

interface ComposerShellProps {
  error: string | null;
  warning: ReactNode;
  above?: ReactNode;
  context: ReactNode;
  children: ReactNode;
  bar: ReactNode;
}

export function ComposerShell({
  error,
  warning,
  above = null,
  context,
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
      {context}
      <div className="composer">
        {children}
        <div className="comp-bar">{bar}</div>
      </div>
    </div>
  );
}
