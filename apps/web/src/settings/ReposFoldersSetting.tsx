import './repos-folders.css';
import { useId, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReposFolder } from '@spark-outpost/contracts';
import { projectKeys, projectsApi } from '../api/projects.ts';
import { FolderDialog } from '../chat/project/FolderDialog.tsx';
import { PlusIcon, XIcon } from '../ui/icons.tsx';
import { SettingRow } from './SettingRow.tsx';

export const REPOS_FOLDERS_LABEL = 'Repos folders';

const HINT =
  'Where you clone repos. When you ask a chat about a repo it doesn’t have, the agent looks here and asks before linking one. A wider folder, even your home folder, lets agents find more. Clone a repository starts in the first one.';

function savedPaths(folders: readonly ReposFolder[]): string[] {
  return folders.filter((folder) => !folder.suggested).map((folder) => folder.path);
}

export function ReposFoldersSetting() {
  const hintId = useId();
  const queryClient = useQueryClient();
  const [picking, setPicking] = useState(false);
  const folders = useQuery({
    queryKey: projectKeys.reposFolders,
    queryFn: projectsApi.reposFolders,
  });
  const save = useMutation({
    mutationFn: projectsApi.saveReposFolders,
    onSuccess: (saved) => {
      queryClient.setQueryData(projectKeys.reposFolders, saved);
      setPicking(false);
    },
  });
  const shown = folders.data?.folders ?? [];
  const kept = shown.map((folder) => folder.path);
  const add = (path: string) => save.mutate(kept.includes(path) ? kept : [...kept, path]);
  const remove = (path: string) => save.mutate(kept.filter((folder) => folder !== path));
  const error = folders.error ?? (picking ? null : save.error);
  return (
    <SettingRow label={REPOS_FOLDERS_LABEL} hint={HINT} hintId={hintId}>
      <div className="repos-folders" aria-describedby={hintId}>
        {shown.length === 0 && folders.isSuccess && (
          <p className="set-hint">None yet. Add the folder where you keep your repos.</p>
        )}
        {shown.length > 0 && (
          <ul className="repos-folders-list" aria-label={REPOS_FOLDERS_LABEL}>
            {shown.map((folder) => (
              <li key={folder.path} className="repos-folders-item">
                <span className="repos-folders-path" title={folder.path}>
                  {folder.displayPath}
                </span>
                {folder.suggested && <span className="repos-folders-tag">Suggested</span>}
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Remove ${folder.displayPath}`}
                  title="Remove"
                  disabled={save.isPending}
                  onClick={() => remove(folder.path)}
                >
                  <XIcon />
                </button>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          className="btn line sm"
          disabled={save.isPending}
          onClick={() => {
            save.reset();
            setPicking(true);
          }}
        >
          <PlusIcon />
          Add folder…
        </button>
        {savedPaths(shown).length === 0 && shown.length > 0 && (
          <p className="set-hint">Suggested from where your projects are until you change them.</p>
        )}
        {error && (
          <p className="set-hint" role="alert">
            {error.message}
          </p>
        )}
      </div>
      <AnimatePresence>
        {picking && (
          <FolderDialog
            key="repos-folder"
            purpose="repos"
            startPath={shown[0]?.path ?? null}
            linking={save.isPending}
            error={save.isError ? save.error.message : null}
            onUse={add}
            onClose={() => setPicking(false)}
          />
        )}
      </AnimatePresence>
    </SettingRow>
  );
}
