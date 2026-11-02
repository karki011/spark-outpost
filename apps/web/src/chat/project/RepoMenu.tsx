import type { RefObject } from 'react';
import type { Project } from '@spark-outpost/contracts';
import { FolderIcon, PlusIcon, TickIcon, XIcon } from '../../ui/icons.tsx';
import { AllowlistEditor } from './AllowlistEditor.tsx';
import type { PickerAction } from '../../ui/ChoicePicker.tsx';
import type { RepoChange } from './repo-list.ts';

interface RepoMenuProps {
  id: string;
  open: boolean;
  panelRef: RefObject<HTMLDivElement | null>;
  linked: Project[];
  recent: Project[];
  busy: boolean;
  error: string | null;
  actions: readonly PickerAction[];
  onChange: (request: RepoChange) => void;
}

function RepoText({ project }: { project: Project }) {
  return (
    <span className="repo-text">
      <b>{project.name}</b>
      <small title={project.rootPath}>{project.displayPath}</small>
    </span>
  );
}

function LinkedRepo({
  project,
  primary,
  busy,
  onChange,
}: {
  project: Project;
  primary: boolean;
  busy: boolean;
  onChange: (request: RepoChange) => void;
}) {
  return (
    <li className="repo-row" title={project.rootPath}>
      <span className="mi">
        <FolderIcon />
      </span>
      <RepoText project={project} />
      {primary ? (
        <span className="repo-tag">Primary</span>
      ) : (
        <button
          type="button"
          className="repo-act"
          aria-label={`Make ${project.name} primary`}
          disabled={busy}
          onClick={() => onChange({ type: 'primary', projectId: project.id })}
        >
          Make primary
        </button>
      )}
      <button
        type="button"
        className="chip-x"
        aria-label={`Remove ${project.name}`}
        disabled={busy}
        onClick={() => onChange({ type: 'remove', projectId: project.id })}
      >
        <XIcon />
      </button>
    </li>
  );
}

export function RepoMenu({
  id,
  open,
  panelRef,
  linked,
  recent,
  busy,
  error,
  actions,
  onChange,
}: RepoMenuProps) {
  return (
    <div
      ref={panelRef}
      id={id}
      className={open ? 'mpop left repopop open' : 'mpop left repopop'}
      role="dialog"
      aria-label="Project folders"
    >
      {linked.length > 0 && (
        <>
          <div className="mgroup">In this chat</div>
          <ul className="repo-list" aria-label="Linked repos">
            {linked.map((project, index) => (
              <LinkedRepo
                key={project.id}
                project={project}
                primary={index === 0}
                busy={busy}
                onChange={onChange}
              />
            ))}
          </ul>
          <AllowlistEditor project={linked[0]!} />
        </>
      )}
      {recent.length > 0 && <div className="mgroup">Recent</div>}
      {recent.map((project) => (
        <button
          key={project.id}
          type="button"
          className="mopt"
          disabled={busy}
          onClick={() => onChange({ type: 'add', projectId: project.id })}
        >
          <span className="mi">
            <FolderIcon />
          </span>
          <RepoText project={project} />
        </button>
      ))}
      <button
        type="button"
        className="mopt"
        aria-pressed={linked.length === 0}
        disabled={busy}
        onClick={() => onChange({ type: 'clear' })}
      >
        <span className="mi">
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M5 6h14v9H9l-4 4z"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <b>No project folder</b>
        <TickIcon />
      </button>
      <div className="repo-sep" />
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          className="mopt"
          disabled={busy || action.disabled}
          onClick={action.onSelect}
        >
          <span className="mi">
            <PlusIcon />
          </span>
          <span className="repo-text">
            <b>{action.label}</b>
            {action.description && <small>{action.description}</small>}
          </span>
        </button>
      ))}
      {error && (
        <p className="mpop-error" role="alert">
          {error}
        </p>
      )}
      <p className="eff-note repo-note">
        Plan and read-only modes only read these folders. Other agent modes can also change them,
        asking first as the mode you picked says.
      </p>
    </div>
  );
}
