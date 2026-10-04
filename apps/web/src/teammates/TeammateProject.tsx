import { useRef, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { projectKeys, projectsApi } from '../api/projects.ts';
import { FolderDialog } from '../chat/project/FolderDialog.tsx';
import { useProjects } from '../chat/project/use-chat-repos.ts';
import { ChoicePicker } from '../ui/ChoicePicker.tsx';
import { FolderIcon } from '../ui/icons.tsx';

const NO_PROJECT = '';

interface TeammateProjectProps {
  projectIds: readonly string[];
  onChange: (projectIds: string[]) => void;
}

export function TeammateProject({ projectIds, onChange }: TeammateProjectProps) {
  const client = useQueryClient();
  const projects = useProjects();
  const browseRef = useRef<HTMLButtonElement>(null);
  const [browsing, setBrowsing] = useState(false);
  const close = () => {
    setBrowsing(false);
    browseRef.current?.focus();
  };
  const add = useMutation({
    mutationFn: (rootPath: string) => projectsApi.create(rootPath),
    onSuccess: async (project) => {
      await client.invalidateQueries({ queryKey: projectKeys.all });
      onChange([project.id]);
      close();
    },
  });
  const choices = [
    { id: NO_PROJECT, label: 'No project', description: 'Chats start without a linked folder.' },
    ...(projects.data ?? []).map((project) => ({
      id: project.id,
      label: project.name,
      description: project.displayPath,
    })),
  ];
  return (
    <div className="field">
      <span>Default project</span>
      <div className="tm-pick-row">
        <ChoicePicker
          label="Default project"
          choices={choices}
          value={projectIds[0] ?? NO_PROJECT}
          onChange={(id) => onChange(id ? [id] : [])}
        />
        <button
          ref={browseRef}
          type="button"
          className="btn line sm"
          onClick={() => {
            add.reset();
            setBrowsing(true);
          }}
        >
          <FolderIcon />
          Choose folder…
        </button>
      </div>
      <AnimatePresence>
        {browsing && (
          <FolderDialog
            key="folders"
            stacked
            linking={add.isPending}
            error={add.isError ? add.error.message : null}
            onUse={(rootPath) => add.mutate(rootPath)}
            onClose={close}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
