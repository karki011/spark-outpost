import { useState, type ReactNode } from 'react';
import { AnimatePresence } from 'motion/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Project } from '@spark-outpost/contracts';
import { projectKeys, projectsApi } from '../api/projects.ts';
import { FolderDialog } from '../chat/project/FolderDialog.tsx';
import { useRemoteClient } from '../phone/use-remote-client.ts';
import type { PickerAction } from '../ui/ChoicePicker.tsx';
import { defaultFolderPath, folderActions, type FolderPlace } from './add-folder.ts';
import { NotGitDialog } from './NotGitDialog.tsx';

type Opener = HTMLElement | null;

interface OpenDialog {
  mode: 'browse' | 'clone';
  opener: Opener;
  startPath: string | null;
}

interface PlainFolder {
  project: Project;
  problem: string | null;
  opener: Opener;
}

interface LinkRequest {
  rootPath: string;
  opener: Opener;
  offerGit: boolean;
}

interface AddFolderOptions {
  onAdded: (project: Project) => void;
  inline?: boolean;
}

export interface AddFolder {
  addFolder: () => void;
  cloneRepo: () => void;
  openDialog: () => void;
  linkFolder: (rootPath: string) => Promise<void>;
  actions: PickerAction[];
  allowed: boolean;
  busy: boolean;
  error: string | null;
  showing: boolean;
  flow: ReactNode;
}

function activeElement(): Opener {
  return document.activeElement instanceof HTMLElement ? document.activeElement : null;
}

function focusBack(opener: Opener): void {
  if (opener?.isConnected) opener.focus();
}

export function useAddFolder({ onAdded, inline = false }: AddFolderOptions): AddFolder {
  const queryClient = useQueryClient();
  const { remote, allows } = useRemoteClient();
  const allowed = allows('projects');
  const place: FolderPlace = remote ? 'remote' : 'this-mac';
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const [plain, setPlain] = useState<PlainFolder | null>(null);

  const added = async (project: Project, opener: Opener, offerGit = true) => {
    queryClient.setQueryData<Project[]>(projectKeys.all, (list) =>
      list && !list.some((item) => item.id === project.id) ? [...list, project] : list,
    );
    void queryClient.invalidateQueries({ queryKey: projectKeys.all });
    setDialog(null);
    onAdded(project);
    if (!offerGit) return;
    const git = await projectsApi.git(project.id).catch(() => null);
    if (git && git.repository !== true) setPlain({ project, problem: git.problem, opener });
    else focusBack(opener);
  };

  const link = useMutation({
    mutationFn: (request: LinkRequest) => projectsApi.create(request.rootPath),
    onSuccess: (project, request) => void added(project, request.opener, request.offerGit),
  });

  const open = (mode: OpenDialog['mode']) => {
    if (!allowed) return;
    link.reset();
    const projects = queryClient.getQueryData<Project[]>(projectKeys.all) ?? [];
    setDialog({ mode, opener: activeElement(), startPath: defaultFolderPath(projects) });
  };
  const addFolder = () => open('browse');

  const closeDialog = () => {
    focusBack(dialog?.opener ?? null);
    setDialog(null);
  };

  const closePlain = () => {
    focusBack(plain?.opener ?? null);
    setPlain(null);
  };

  const opener = dialog?.opener ?? null;
  const flow = (
    <>
      <AnimatePresence>
        {dialog && (
          <FolderDialog
            key={`add-folder-${dialog.mode}`}
            initialMode={dialog.mode}
            startPath={dialog.startPath}
            stacked
            inline={inline}
            linking={link.isPending}
            error={link.isError ? link.error.message : null}
            onUse={(rootPath) => link.mutate({ rootPath, opener, offerGit: true })}
            onCloned={(project) => void added(project, opener)}
            onClose={closeDialog}
          />
        )}
      </AnimatePresence>
      {plain && (
        <NotGitDialog
          project={plain.project}
          problem={plain.problem}
          inline={inline}
          onDone={closePlain}
        />
      )}
    </>
  );

  return {
    addFolder,
    cloneRepo: () => open('clone'),
    openDialog: () => open('browse'),
    linkFolder: (rootPath) =>
      link.mutateAsync({ rootPath, opener: null, offerGit: false }).then(() => undefined),
    actions: folderActions({
      place,
      allowed,
      onAddFolder: addFolder,
      onClone: () => open('clone'),
    }),
    allowed,
    busy: link.isPending,
    error: link.isError && !dialog ? link.error.message : null,
    showing: dialog !== null || plain !== null,
    flow,
  };
}
