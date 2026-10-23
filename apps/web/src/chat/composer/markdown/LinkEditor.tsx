import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { LinkTarget } from './md-block-format.ts';

interface LinkEditorProps {
  target: LinkTarget;
  position: CSSProperties;
  onSave: (label: string, url: string) => void;
  onRemove: () => void;
  onClose: () => void;
}

export function LinkEditor({ target, position, onSave, onRemove, onClose }: LinkEditorProps) {
  const [label, setLabel] = useState(target.label);
  const [url, setUrl] = useState(target.url);
  const labelRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const textId = useId();
  const linkId = useId();
  const canSave = url.trim() !== '';
  const focusLabel = target.label === '' && target.url !== '';

  useEffect(() => {
    (focusLabel ? labelRef : urlRef).current?.focus();
  }, [focusLabel]);

  const save = () => {
    if (canSave) onSave(label, url);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };

  return (
    <form
      className="mdf-link"
      role="dialog"
      aria-label={target.existing ? 'Edit link' : 'Add link'}
      style={position}
      onKeyDown={onKeyDown}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onClose();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <label htmlFor={textId}>Text</label>
      <input
        ref={labelRef}
        id={textId}
        value={label}
        autoComplete="off"
        onChange={(event) => setLabel(event.target.value)}
      />
      <label htmlFor={linkId}>Link</label>
      <input
        ref={urlRef}
        id={linkId}
        type="url"
        value={url}
        placeholder="https://"
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => setUrl(event.target.value)}
      />
      <div className="mdf-link-foot">
        <span className="mdf-link-keys">Enter to save</span>
        {target.existing && (
          <button type="button" className="btn sm" onClick={onRemove}>
            Remove
          </button>
        )}
        <button type="submit" className="btn primary sm" disabled={!canSave}>
          Save
        </button>
      </div>
    </form>
  );
}
