import { useProjects } from '../chat/project/use-chat-repos.ts';
import { useAddFolder } from '../projects/use-add-folder.tsx';
import { ChoicePicker } from '../ui/ChoicePicker.tsx';

const NO_PROJECT = '';

interface TeammateProjectProps {
  projectIds: readonly string[];
  onChange: (projectIds: string[]) => void;
}

export function TeammateProject({ projectIds, onChange }: TeammateProjectProps) {
  const projects = useProjects();
  const adder = useAddFolder({ onAdded: (project) => onChange([project.id]) });
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
      <ChoicePicker
        label="Default project"
        choices={choices}
        value={projectIds[0] ?? NO_PROJECT}
        actions={adder.actions}
        error={adder.error}
        onChange={(id) => onChange(id ? [id] : [])}
      />
      {adder.flow}
    </div>
  );
}
