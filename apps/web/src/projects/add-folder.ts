import type { Project } from '@spark-outpost/contracts';
import { PHONE_SWITCH_OFF } from '../phone/use-remote-client.ts';
import type { PickerAction } from '../ui/ChoicePicker.tsx';

export const ADD_FOLDER_LABEL = 'Add folder…';
export const CLONE_LABEL = 'Clone a repository…';

export type FolderPlace = 'this-mac' | 'remote';

export function defaultFolderPath(projects: readonly Project[]): string | null {
  const newest = projects.reduce<Project | null>(
    (latest, project) => (!latest || project.createdAt > latest.createdAt ? project : latest),
    null,
  );
  if (!newest) return null;
  const slash = newest.rootPath.lastIndexOf('/');
  return slash > 0 ? newest.rootPath.slice(0, slash) : null;
}

const ADD_NOTES: Record<FolderPlace, string> = {
  'this-mac': 'Pick or make a folder on this Mac',
  remote: 'Pick or make a folder on your Mac',
};

export interface FolderActionHandlers {
  place: FolderPlace;
  allowed: boolean;
  onAddFolder: () => void;
  onClone: () => void;
}

export function folderActions({
  place,
  allowed,
  onAddFolder,
  onClone,
}: FolderActionHandlers): PickerAction[] {
  const cloneNote =
    place === 'remote' ? 'Spark clones it on your Mac' : 'Spark clones it on this Mac';
  return [
    {
      id: 'add-folder',
      label: ADD_FOLDER_LABEL,
      description: allowed ? ADD_NOTES[place] : PHONE_SWITCH_OFF,
      disabled: !allowed,
      onSelect: onAddFolder,
    },
    {
      id: 'clone',
      label: CLONE_LABEL,
      description: allowed ? cloneNote : PHONE_SWITCH_OFF,
      disabled: !allowed,
      onSelect: onClone,
    },
  ];
}
