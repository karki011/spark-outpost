import { useId } from 'react';
import type { Project, ProjectTrust } from '@spark-outpost/contracts';
import { ChevronIcon } from '../ui/icons.tsx';
import { ProjectBrowser } from './ProjectBrowser.tsx';
import { ProjectBuilders } from './ProjectBuilders.tsx';
import { ProjectPreview } from './ProjectPreview.tsx';
import { ProjectSignIns } from './ProjectSignIns.tsx';

function trustLabel(trust: ProjectTrust | undefined): string {
  if (!trust) return 'Not asked yet';
  if (!trust.trusted) return 'Not trusted';
  return trust.redirectsConfirmed ? 'Trusted, with key and proxy settings' : 'Trusted';
}

interface ProjectRowProps {
  project: Project;
  trust: ProjectTrust | undefined;
  open: boolean;
  busy: boolean;
  parallelAvailable: boolean;
  onToggle: () => void;
  onRevoke: () => void;
}

export function ProjectRow({
  project,
  trust,
  open,
  busy,
  parallelAvailable,
  onToggle,
  onRevoke,
}: ProjectRowProps) {
  const bodyId = useId();
  return (
    <li className={open ? 'set-project open' : 'set-project'}>
      <div className="set-project-head">
        <h4 className="set-project-title">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={open ? bodyId : undefined}
            onClick={onToggle}
          >
            <ChevronIcon />
            <span className="set-project-name">{project.name}</span>
            <span className="set-project-path">{project.displayPath}</span>
            {project.preview && <span className="set-project-chip">Preview</span>}
            <span className="set-project-trust">{trustLabel(trust)}</span>
          </button>
        </h4>
        {trust?.trusted && (
          <button
            type="button"
            className="btn line sm"
            aria-label={`Stop trusting ${project.name}`}
            disabled={busy}
            onClick={onRevoke}
          >
            Stop trusting
          </button>
        )}
      </div>
      {open && (
        <div
          id={bodyId}
          className="set-project-body"
          role="group"
          aria-label={`Settings for ${project.name}`}
        >
          <p className="set-project-root">{project.rootPath}</p>
          <ProjectBuilders project={project} available={parallelAvailable} />
          <ProjectBrowser project={project} />
          <ProjectSignIns project={project} />
          <ProjectPreview project={project} />
        </div>
      )}
    </li>
  );
}
