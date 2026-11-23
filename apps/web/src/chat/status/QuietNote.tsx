import { quietText } from './status-text.ts';
import { QUIET_MS, useNow } from './use-status-line.ts';

interface QuietNoteProps {
  since: number | undefined;
  className: string;
  prefix?: string;
}

export function QuietNote({ since, className, prefix = '' }: QuietNoteProps) {
  const now = useNow(since !== undefined);
  if (since === undefined || now - since < QUIET_MS) return null;
  return (
    <span className={className}>
      {prefix}
      {quietText(now - since)}
    </span>
  );
}
