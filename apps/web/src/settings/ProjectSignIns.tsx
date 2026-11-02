import './project-preview.css';
import './project-sign-ins.css';
import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SIGN_INS_NEED_APP, type Project, type SavedSignIn } from '@spark-outpost/contracts';
import { signInKeys, signInsApi } from '../api/sign-ins.ts';
import { desktopBrowser } from '../desktop/desktop-bridge.ts';
import { SettingRow } from './SettingRow.tsx';
import { SignInForm } from './SignInForm.tsx';
import { withSite } from './sign-in-draft.ts';

const LABEL = 'Saved sign-ins';
const HINT =
  'Test accounts an agent can use to get past a sign-in page in the Browser pane. Spark types them in; agents never see them.';
const LOST = 'Not in the keychain. Edit to save it again.';

type Editing = { id: string } | 'new' | null;

interface ListProps {
  project: Project;
  signIns: readonly SavedSignIn[];
  editing: Editing;
  onEdit: (next: Editing) => void;
}

function AddThisSite({ project, signIn }: { project: Project; signIn: SavedSignIn }) {
  const queryClient = useQueryClient();
  const add = useMutation({
    mutationFn: (site: string) => signInsApi.update(project.id, signIn.id, withSite(signIn, site)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: signInKeys.project(project.id) }),
  });
  const site = signIn.refusedSite;
  if (site === null)
    return add.isSuccess ? (
      <p className="signin-refused" role="status">
        <span>
          Approved <code>{add.variables}</code> for {signIn.label}. Return to your chat and ask the
          agent to retry this saved sign-in. Spark will ask before filling it on the changed site
          list.
        </span>
      </p>
    ) : null;
  return (
    <p className="signin-refused" role="status">
      <span>
        An agent’s tab ended on <code>{site}</code>, so Spark typed nothing. Add it only if this is
        where the app sends you to sign in. You can then ask the agent to retry this saved sign-in
        without entering the password again.
      </span>
      <button
        type="button"
        className="btn line sm"
        disabled={add.isPending}
        aria-label={`Add this site, ${site}, to ${signIn.label}`}
        onClick={() => add.mutate(site)}
      >
        Add this site
      </button>
      {add.error && <span role="alert">{add.error.message}</span>}
    </p>
  );
}

function SignInList({ project, signIns, editing, onEdit }: ListProps) {
  return (
    <ul className="signin-list" aria-label={`Saved sign-ins in ${project.name}`}>
      {signIns.map((signIn) => {
        const open = editing !== null && editing !== 'new' && editing.id === signIn.id;
        return (
          <li key={signIn.id}>
            <div className="signin-item">
              <span className="signin-label">{signIn.label}</span>
              <code className="signin-origin">
                {signIn.origin}
                {signIn.sites.length > 0 && ` +${signIn.sites.length}`}
              </code>
              <span className="signin-user">{signIn.username ?? LOST}</span>
              <button
                type="button"
                className="btn ghost sm"
                aria-expanded={open}
                aria-label={`Edit sign-in ${signIn.label}`}
                onClick={() => onEdit(open ? null : { id: signIn.id })}
              >
                Edit
              </button>
            </div>
            <AddThisSite project={project} signIn={signIn} />
            {open && <SignInForm project={project} saved={signIn} onDone={() => onEdit(null)} />}
          </li>
        );
      })}
    </ul>
  );
}

export function ProjectSignIns({ project }: { project: Project }) {
  const hintId = useId();
  const [editing, setEditing] = useState<Editing>(null);
  const available = desktopBrowser() !== null;
  const signIns = useQuery({
    queryKey: signInKeys.project(project.id),
    queryFn: () => signInsApi.list(project.id),
    enabled: available,
  });
  const hint = available ? (signIns.error?.message ?? HINT) : SIGN_INS_NEED_APP;
  return (
    <div className="set-builders" role="group" aria-label={`${LABEL} in ${project.name}`}>
      <SettingRow
        label={LABEL}
        doc={{ page: 'use-the-browser', heading: 'save-a-test-sign-in' }}
        hint={hint}
        hintId={hintId}
        disabled={!available}
      >
        <button
          type="button"
          className="btn line sm"
          disabled={!available}
          aria-expanded={editing === 'new'}
          aria-label={`Add a sign-in to ${project.name}`}
          aria-describedby={hintId}
          onClick={() => setEditing(editing === 'new' ? null : 'new')}
        >
          Add
        </button>
      </SettingRow>
      {available && (signIns.data?.length ?? 0) > 0 && (
        <SignInList
          project={project}
          signIns={signIns.data ?? []}
          editing={editing}
          onEdit={setEditing}
        />
      )}
      {editing === 'new' && (
        <SignInForm project={project} saved={null} onDone={() => setEditing(null)} />
      )}
    </div>
  );
}
