import { useId } from 'react';

export const AUTO_JOIN_COVERS =
  'Join meetings automatically is on, so Spark opens it at the start.';

interface JoinAtStartButtonProps {
  title: string;
  className: string;
  autoJoin: boolean;
  onAsk: () => void;
}

export function JoinAtStartButton({ title, className, autoJoin, onAsk }: JoinAtStartButtonProps) {
  const reasonId = useId();
  if (autoJoin) {
    return (
      <>
        <button
          type="button"
          className={className}
          aria-disabled="true"
          aria-describedby={reasonId}
          title={AUTO_JOIN_COVERS}
          data-off
        >
          Join at start
        </button>
        <span id={reasonId} className="sr-only">
          {AUTO_JOIN_COVERS}
        </span>
      </>
    );
  }
  return (
    <button
      type="button"
      className={className}
      aria-label={`Join at start: ${title}`}
      onClick={onAsk}
    >
      Join at start
    </button>
  );
}
