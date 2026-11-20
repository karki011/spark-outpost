import { XIcon } from '../ui/icons.tsx';

export function DismissibleNote({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  return (
    <p className="native-note native-restart" role="status">
      <span>{text}</span>
      <button type="button" className="icon-btn" aria-label="Dismiss" onClick={onDismiss}>
        <XIcon />
      </button>
    </p>
  );
}
