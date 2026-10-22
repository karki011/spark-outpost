import '../chat/project/project.css';
import './add-folder.css';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Project } from '@spark-outpost/contracts';
import { projectKeys, projectsApi } from '../api/projects.ts';
import { BlobToggle } from '../brand/BlobToggle.tsx';
import { wrapTabFocus } from '../ui/focus-trap.ts';

const FOCUSABLE = 'button:not(:disabled)';

interface NotGitDialogProps {
  project: Project;
  problem: string | null;
  inline: boolean;
  onDone: () => void;
}

export function NotGitDialog({ project, problem, inline, onDone }: NotGitDialogProps) {
  const ids = useId();
  const queryClient = useQueryClient();
  const panelRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
  const [makeRepository, setMakeRepository] = useState(false);
  const init = useMutation({
    mutationFn: () => projectsApi.gitInit(project.id),
    onSuccess: (git) => {
      queryClient.setQueryData(projectKeys.git(project.id), git);
      onDone();
    },
  });

  const finish = () => {
    if (init.isPending) return;
    if (makeRepository) init.mutate();
    else onDone();
  };

  useEffect(() => {
    doneRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const buttons = [...(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      wrapTabFocus(event, () => buttons);
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      if (!init.isPending) onDone();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  });

  const panel = (
    <div
      ref={panelRef}
      className={inline ? 'fdlg inline notgit' : 'fdlg notgit'}
      role="dialog"
      aria-modal={inline ? undefined : true}
      aria-labelledby={`${ids}title`}
      aria-describedby={`${ids}lede`}
    >
      <div className="fdlg-head">
        <h3 id={`${ids}title`}>Added {project.name}</h3>
      </div>
      <p className="fdlg-lede" id={`${ids}lede`}>
        {problem
          ? `Spark couldn’t tell whether ${project.name} is a git repository: ${problem}`
          : `${project.name} isn’t a git repository, so chats in it open no pull request.`}
      </p>
      {!problem && (
        <label className="notgit-choice">
          <BlobToggle
            size="sm"
            label="Make it a git repository"
            checked={makeRepository}
            onChange={setMakeRepository}
          />
          <span aria-hidden="true">Make it a git repository</span>
        </label>
      )}
      {init.isError && (
        <p className="fdlg-error" role="alert">
          {init.error.message}
        </p>
      )}
      <div className="fdlg-foot">
        <span className="fdlg-path" title={project.rootPath}>
          {project.displayPath}
        </span>
        <button
          ref={doneRef}
          type="button"
          className="btn primary sm"
          disabled={init.isPending}
          onClick={finish}
        >
          {init.isPending ? 'Making it…' : 'Done'}
        </button>
      </div>
    </div>
  );

  if (inline) return panel;
  return createPortal(<div className="fdlg-scrim over-dialog">{panel}</div>, document.body);
}
