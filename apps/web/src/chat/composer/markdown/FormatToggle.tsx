interface FormatToggleProps {
  open: boolean;
  onToggle: (open: boolean) => void;
}

export function FormatToggle({ open, onToggle }: FormatToggleProps) {
  return (
    <button
      type="button"
      className="mdf-toggle"
      aria-label="Formatting"
      aria-pressed={open}
      title="Formatting"
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onToggle(!open)}
    >
      <span aria-hidden="true">Aa</span>
    </button>
  );
}
