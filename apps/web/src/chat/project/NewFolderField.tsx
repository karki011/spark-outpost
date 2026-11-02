import '../../projects/add-folder.css';
import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { folderNameProblem } from '@spark-outpost/contracts';
import { projectsApi } from '../../api/projects.ts';

interface NewFolderFieldProps {
  parent: string;
  onCreated: (path: string) => void;
  onCancel: () => void;
}

export function NewFolderField({ parent, onCreated, onCancel }: NewFolderFieldProps) {
  const ids = useId();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => projectsApi.createFolder(parent, name.trim()),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ['folders'] });
      onCreated(created.path);
    },
  });

  const submit = () => {
    const local = folderNameProblem(name);
    setProblem(local);
    if (!local && !create.isPending) create.mutate();
  };

  const shown = problem ?? (create.isError ? create.error.message : null);

  return (
    <form
      className="fdlg-newfolder"
      aria-label="New folder"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <input
        className="inp"
        aria-label="New folder name"
        aria-describedby={shown ? `${ids}problem` : undefined}
        aria-invalid={shown ? true : undefined}
        placeholder="New folder name"
        autoFocus
        maxLength={255}
        value={name}
        onChange={(event) => {
          setName(event.target.value);
          setProblem(null);
          create.reset();
        }}
      />
      <button type="button" className="btn ghost sm" onClick={onCancel}>
        Cancel
      </button>
      <button type="submit" className="btn line sm" disabled={create.isPending}>
        {create.isPending ? 'Making…' : 'Make folder'}
      </button>
      {shown && (
        <p className="fdlg-note bad" id={`${ids}problem`} role="alert">
          {shown}
        </p>
      )}
    </form>
  );
}
