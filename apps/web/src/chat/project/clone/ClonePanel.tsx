import './clone-panel.css';
import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Project } from '@spark-outpost/contracts';
import { requestSettings } from '../../../settings/settings-request.ts';
import { cloneApi, cloneKeys } from './clone-api.ts';
import {
  canClone,
  EMPTY_FORM,
  formFromJob,
  formProblems,
  joinPath,
  splitDestination,
  withName,
  withUrl,
} from './clone-form.ts';
import { CloneRepoList } from './CloneRepoList.tsx';
import { CloneFailed, CloneProgress } from './CloneStatus.tsx';
import { useCloneJobs } from './use-clone-jobs.ts';

interface ClonePanelProps {
  hidden: boolean;
  parent: string | null;
  onParentChange: (parent: string) => void;
  onPickParent: (current: string) => void;
  onCloned: (project: Project) => void;
  onClose: () => void;
}

export function ClonePanel({
  hidden,
  parent: pickedParent,
  onParentChange,
  onPickParent,
  onCloned,
  onClose,
}: ClonePanelProps) {
  const ids = useId();
  const options = useQuery({ queryKey: cloneKeys.options, queryFn: cloneApi.options });
  const { job, start, cancel, dismiss } = useCloneJobs(true);
  const [form, setForm] = useState(EMPTY_FORM);
  const [cancelled, setCancelled] = useState(false);
  const announced = useRef(new Set<string>());
  const parent = pickedParent ?? options.data?.defaultParent ?? null;
  const problems = formProblems(form);
  const ready = canClone(form, parent);
  const finalPath = parent && form.name.trim() ? joinPath(parent, form.name) : (parent ?? '');
  const forget = dismiss.mutate;

  useEffect(() => {
    if (job?.status !== 'done' || !job.project || announced.current.has(job.id)) return;
    announced.current.add(job.id);
    forget(job.id);
    onCloned(job.project);
  }, [job, forget, onCloned]);

  const submit = () => {
    if (!ready || !parent || start.isPending) return;
    if (job && job.status !== 'cloning') forget(job.id);
    setCancelled(false);
    start.mutate({ url: form.url.trim(), parentPath: parent, name: form.name.trim() });
  };
  const retry = () => {
    if (!job) return;
    setForm(formFromJob(job));
    onParentChange(splitDestination(job.destination).parent);
    start.reset();
    forget(job.id);
  };
  const connect = () => {
    onClose();
    requestSettings('tools');
  };

  if (hidden) return null;
  if (job?.status === 'cloning' || job?.status === 'done') {
    return (
      <CloneProgress
        job={job}
        cancelling={cancel.isPending}
        onCancel={() =>
          cancel.mutate(job.id, {
            onSuccess: (stopped) => {
              if (stopped.status !== 'cancelled') return;
              setCancelled(true);
              forget(stopped.id);
            },
          })
        }
        onClose={onClose}
      />
    );
  }
  if (job?.status === 'failed') return <CloneFailed job={job} onRetry={retry} onClose={onClose} />;

  return (
    <form
      className="clone-form"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="clone-body">
        {(cancelled || job?.status === 'cancelled') && (
          <p className="fdlg-note" role="status">
            Clone cancelled. Nothing was added.
          </p>
        )}
        <CloneRepoList
          options={options.data}
          loading={options.isPending}
          selectedUrl={form.url}
          onPick={(url) => setForm((current) => withUrl(current, url))}
          onConnect={connect}
        />
        {options.isError && (
          <p className="fdlg-note bad" role="alert">
            {options.error.message}
          </p>
        )}
        <label className="field">
          <span>Clone address</span>
          <input
            className="inp mono"
            placeholder="https://github.com/owner/repo.git or git@github.com:owner/repo.git"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            value={form.url}
            aria-invalid={problems.url ? true : undefined}
            aria-describedby={problems.url ? `${ids}url` : undefined}
            onChange={(event) => setForm((current) => withUrl(current, event.target.value))}
          />
        </label>
        {problems.url && (
          <p className="clone-problem" id={`${ids}url`}>
            {problems.url}
          </p>
        )}
        <div className="clone-dest">
          <div className="field">
            <span id={`${ids}into`}>Clone into</span>
            <div className="clone-parent">
              <span className="clone-parent-path" title={parent ?? undefined}>
                {parent ?? '…'}
              </span>
              <button
                type="button"
                className="btn line sm"
                aria-describedby={`${ids}into`}
                disabled={!parent}
                onClick={() => parent && onPickParent(parent)}
              >
                Change…
              </button>
            </div>
          </div>
          <label className="field">
            <span>Folder name</span>
            <input
              className="inp"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              value={form.name}
              aria-invalid={problems.name ? true : undefined}
              aria-describedby={problems.name ? `${ids}name` : undefined}
              onChange={(event) => setForm((current) => withName(current, event.target.value))}
            />
          </label>
        </div>
        {problems.name && (
          <p className="clone-problem" id={`${ids}name`}>
            {problems.name}
          </p>
        )}
        {start.isError && (
          <p className="clone-problem" role="alert">
            {start.error.message}
          </p>
        )}
      </div>
      <div className="fdlg-foot">
        <span className="fdlg-path" title={finalPath}>
          {finalPath}
        </span>
        <button type="button" className="btn ghost sm" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="btn primary sm" disabled={!ready || start.isPending}>
          {start.isPending ? 'Starting…' : 'Clone'}
        </button>
      </div>
    </form>
  );
}
