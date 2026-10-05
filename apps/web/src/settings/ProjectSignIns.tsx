import './project-preview.css';
import './project-sign-ins.css';
import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SIGN_INS_NEED_APP, type Project, type SavedSignIn } from '@spark-outpost/contracts';
import { signInKeys, signInsApi } from '../api/sign-ins.ts';
import { desktopBrowser } from '../desktop/desktop-bridge.ts';
import { SettingRow } from './SettingRow.tsx';
import { SignInForm } from './SignInForm.tsx';

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

function SignInList({ project, signIns, editing, onEdit }: ListProps) {
  return (
    <ul className="signin-list" aria-label={`Saved sign-ins in ${project.name}`}>
      {signIns.map((signIn) => {
        const open = editing !== null && editing !== 'new' && editing.id === signIn.id;
        return (
          <li key={signIn.id}>
            <div className="signin-item">
              <span className="signin-label">{signIn.label}</span>
              <code className="signin-origin">{signIn.origin}</code>
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
