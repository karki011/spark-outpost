import { useRef, useState, type KeyboardEvent } from 'react';
import {
  BROWSER_SPACES_MAX,
  BROWSER_SPACE_COLORS,
  BROWSER_SPACE_ICONS,
  BROWSER_NAME_MAX,
  type BrowserProfile,
  type BrowserSpace,
  type BrowserViewLayout,
} from '@spark-outpost/contracts';
import { PenIcon, PlusIcon } from '../ui/icons.tsx';
import { useTooltip } from '../ui/Tooltip.tsx';
import { COLOR_NAMES, ICON_NAMES, SpaceIcon } from './SpaceIcon.tsx';
import { sendViewCommand } from './view-store.ts';

type Editing = { kind: 'new' } | { kind: 'edit'; space: BrowserSpace } | null;

function SpaceButton({
  space,
  index,
  current,
  onChoose,
}: {
  space: BrowserSpace;
  index: number;
  current: boolean;
  onChoose(): void;
}) {
  const tip = useTooltip(`${space.name} (⌃${index + 1})`, { side: 'bottom' });
  return (
    <>
      <button
        type="button"
        role="radio"
        className="bv-space"
        data-space={space.id}
        data-color={space.color}
        aria-checked={current}
        aria-label={space.name}
        aria-keyshortcuts={`Control+${index + 1}`}
        tabIndex={current ? 0 : -1}
        {...tip.triggerProps}
        onClick={onChoose}
      >
        <SpaceIcon icon={space.icon} />
      </button>
      {tip.tooltip}
    </>
  );
}

function SpaceEditor({
  editing,
  heir,
  onSave,
  onDelete,
  onCancel,
}: {
  editing: NonNullable<Editing>;
  heir: string | null;
  onSave(looks: Pick<BrowserSpace, 'name' | 'icon' | 'color'>): void;
  onDelete(): void;
  onCancel(): void;
}) {
  const start = editing.kind === 'edit' ? editing.space : null;
  const [name, setName] = useState(start?.name ?? '');
  const [icon, setIcon] = useState<BrowserSpace['icon']>(start?.icon ?? 'book');
  const [color, setColor] = useState<BrowserSpace['color']>(start?.color ?? 'accent');
  return (
    <form
      className="bv-space-editor"
      aria-label={start ? `Edit ${start.name}` : 'New Space'}
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim() !== '') onSave({ name: name.trim(), icon, color });
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }}
    >
      <input
        className="bv-name-input"
        aria-label="Space name"
        placeholder="Space name"
        autoFocus
        maxLength={BROWSER_NAME_MAX}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <fieldset className="bv-choices">
        <legend>Icon</legend>
        {BROWSER_SPACE_ICONS.map((item) => (
          <label key={item} className="bv-choice" title={ICON_NAMES[item]}>
            <input
              type="radio"
              name="bv-space-icon"
              aria-label={ICON_NAMES[item]}
              checked={icon === item}
              onChange={() => setIcon(item)}
            />
            <SpaceIcon icon={item} />
          </label>
        ))}
      </fieldset>
      <fieldset className="bv-choices">
        <legend>Colour</legend>
        {BROWSER_SPACE_COLORS.map((item) => (
          <label key={item} className="bv-choice bv-choice-word" data-color={item}>
            <input
              type="radio"
              name="bv-space-color"
              checked={color === item}
              onChange={() => setColor(item)}
            />
            <SpaceIcon icon={icon} />
            {COLOR_NAMES[item]}
          </label>
        ))}
      </fieldset>
      <p className="bv-note">A Space only sorts tabs: they all share this profile’s sign-ins.</p>
      <div className="bv-space-actions">
        <button type="submit" className="btn" disabled={name.trim() === ''}>
          Save
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        {start && heir && (
          <button
            type="button"
            className="btn"
            title={`Its tabs move to ${heir}`}
            onClick={onDelete}
          >
            Delete Space
          </button>
        )}
      </div>
    </form>
  );
}

export function ViewSpaces({
  profile,
  layout,
}: {
  profile: BrowserProfile;
  layout: BrowserViewLayout;
}) {
  const group = useRef<HTMLDivElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const { spaces, currentSpaceId } = layout;
  const index = spaces.findIndex((space) => space.id === currentSpaceId);
  const current = spaces[index] ?? null;
  const choose = (id: string) => sendViewCommand(profile, { command: 'space_switch', id });
  const closeEditor = () => {
    setEditing(null);
    requestAnimationFrame(() => addButton.current?.focus());
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[event.key];
    if (step === undefined || spaces.length === 0) return;
    event.preventDefault();
    const next = spaces[(index + step + spaces.length) % spaces.length]!;
    choose(next.id);
    group.current?.querySelector<HTMLElement>(`[data-space="${next.id}"]`)?.focus();
  };
  const heir = spaces[Math.max(0, index - 1) === index ? index + 1 : index - 1]?.name ?? null;

  return (
    <section className="bv-section" aria-label="Spaces">
      <div className="bv-spaces">
        <div
          ref={group}
          className="bv-space-list"
          role="radiogroup"
          aria-label="Space"
          onKeyDown={onKeyDown}
        >
          {spaces.map((space, position) => (
            <SpaceButton
              key={space.id}
              space={space}
              index={position}
              current={space.id === currentSpaceId}
              onChoose={() => choose(space.id)}
            />
          ))}
        </div>
        {current && (
          <button
            type="button"
            className="icon-btn bv-tab-act"
            aria-label={`Edit Space ${current.name}`}
            title={`Edit Space ${current.name}`}
            onClick={() => setEditing({ kind: 'edit', space: current })}
          >
            <PenIcon />
          </button>
        )}
        <button
          ref={addButton}
          type="button"
          className="icon-btn bv-tab-act"
          aria-label="New Space"
          title="New Space"
          disabled={spaces.length >= BROWSER_SPACES_MAX}
          onClick={() => setEditing({ kind: 'new' })}
        >
          <PlusIcon />
        </button>
      </div>
      {current && <p className="bv-space-name">{current.name}</p>}
      {editing && (
        <SpaceEditor
          key={editing.kind === 'edit' ? editing.space.id : 'new'}
          editing={editing}
          heir={heir}
          onCancel={closeEditor}
          onDelete={() => {
            if (editing.kind === 'edit') {
              sendViewCommand(profile, { command: 'space_delete', id: editing.space.id });
            }
            closeEditor();
          }}
          onSave={(looks) => {
            sendViewCommand(
              profile,
              editing.kind === 'edit'
                ? { command: 'space_update', id: editing.space.id, ...looks }
                : { command: 'space_create', ...looks },
            );
            closeEditor();
          }}
        />
      )}
    </section>
  );
}
