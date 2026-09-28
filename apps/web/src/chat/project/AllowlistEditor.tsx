import './allowlist.css';
import { useId, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Project } from '@spark-outpost/contracts';
import { approvalsApi } from '../../api/approvals.ts';
import { projectKeys } from '../../api/projects.ts';
import { ChevronIcon, XIcon } from '../../ui/icons.tsx';

export function AllowlistEditor({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const listId = useId();
  const inputId = useId();
  const save = useMutation({
    mutationFn: (commands: string[]) => approvalsApi.setAllowlist(project.id, commands),
    onSuccess: (updated) => {
      queryClient.setQueryData<Project[]>(projectKeys.all, (projects) =>
        projects?.map((candidate) => (candidate.id === updated.id ? updated : candidate)),
      );
      setDraft('');
    },
  });
  const commands = project.commandAllowlist;
  const add = (event: FormEvent) => {
    event.preventDefault();
    const command = draft.trim();
    if (command && !commands.includes(command)) save.mutate([...commands, command]);
  };

  return (
    <div className="allowlist">
      <button
        type="button"
        className="allow-head"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen(!open)}
      >
        <span>
          Commands that run without asking
          <small>
            {commands.length === 0 ? 'None yet' : `${commands.length} in ${project.name}`}
          </small>
        </span>
        <ChevronIcon />
      </button>
      {open && (
        <div id={listId} className="allow-body">
          {commands.length > 0 && (
            <ul aria-label={`Allowed commands in ${project.name}`}>
              {commands.map((command) => (
                <li key={command}>
                  <code>{command}</code>
                  <button
                    type="button"
                    className="chip-x"
                    aria-label={`Remove ${command}`}
                    disabled={save.isPending}
                    onClick={() => save.mutate(commands.filter((entry) => entry !== command))}
                  >
                    <XIcon />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form className="allow-add" onSubmit={add}>
            <label className="sr-only" htmlFor={inputId}>
              Allow a command
            </label>
            <input
              id={inputId}
              className="inp"
              placeholder="pnpm test"
              value={draft}
              maxLength={500}
              onChange={(event) => setDraft(event.target.value)}
            />
            <button
              type="submit"
              className="btn line sm"
              disabled={!draft.trim() || save.isPending}
            >
              Add
            </button>
          </form>
          <p className="allow-note">
            Used by chats set to Ask before edits or Auto-edit. A listed command also covers the
            same command with more arguments. Pushing asks unless it's listed.
          </p>
          {save.isError && (
            <p className="mpop-error" role="alert">
              {save.error.message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
