interface RadioRowProps {
  id: string;
  label: string;
  hint: string | null;
  tag?: string | null;
  checked: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

export function RadioRow({
  id,
  label,
  hint,
  tag = null,
  checked,
  disabled = false,
  onSelect,
}: RadioRowProps) {
  const tagId = `${id}-tag`;
  const hintId = `${id}-hint`;
  const described = [tag ? tagId : null, hint ? hintId : null].filter(Boolean).join(' ');
  return (
    <button
      type="button"
      className="rrow"
      role="radio"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={described || undefined}
      disabled={disabled}
      onClick={onSelect}
    >
      <i className="radio" />
      <span>
        <b>
          {label}
          {tag && (
            <span className="mtag" id={tagId}>
              {tag}
            </span>
          )}
        </b>
        {hint && <small id={hintId}>{hint}</small>}
      </span>
    </button>
  );
}
