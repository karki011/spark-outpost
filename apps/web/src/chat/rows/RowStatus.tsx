import { PauseIcon, XIcon } from '../../ui/icons.tsx';

export function Spinner() {
  return <span className="spin trow-spin" role="img" aria-label="In progress" />;
}

export function FailedWord({ word = 'failed' }: { word?: string }) {
  return (
    <span className="trow-word bad">
      <XIcon />
      {word}
    </span>
  );
}

export function StoppedWord() {
  return (
    <span className="trow-word">
      <PauseIcon />
      Stopped
    </span>
  );
}
