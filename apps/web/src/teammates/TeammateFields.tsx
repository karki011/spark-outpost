import type { RefObject } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TEAMMATE_NAME_MAX, TEAMMATE_ROLE_MAX } from '@spark-outpost/contracts';
import { setupApi, setupKey } from '../api/setup.ts';
import { TeammateDefaults } from './TeammateDefaults.tsx';
import { TeammateLook } from './TeammateLook.tsx';
import { TeammateProject } from './TeammateProject.tsx';
import { shownFace, type TeammateDraft } from './teammate-draft.ts';

interface TeammateFieldsProps {
  draft: TeammateDraft;
  nameRef?: RefObject<HTMLInputElement | null>;
  nameInvalid: boolean;
  onChange: (draft: TeammateDraft) => void;
}

export function TeammateFields({ draft, nameRef, nameInvalid, onChange }: TeammateFieldsProps) {
  const setup = useQuery({ queryKey: setupKey, queryFn: setupApi.get });
  return (
    <>
      <label className="field">
        <span>Name</span>
        <input
          ref={nameRef}
          className="inp"
          value={draft.name}
          maxLength={TEAMMATE_NAME_MAX}
          placeholder="Pip"
          aria-invalid={nameInvalid}
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
        />
      </label>
      <label className="field">
        <span>Role</span>
        <input
          className="inp"
          value={draft.role}
          maxLength={TEAMMATE_ROLE_MAX}
          placeholder="Frontend helper"
          onChange={(event) => onChange({ ...draft, role: event.target.value })}
        />
      </label>
      <TeammateLook
        picked={draft.face}
        shown={shownFace(draft)}
        onChange={(face) => onChange({ ...draft, face })}
      />
      <h3 className="tm-sub">Defaults for its chats</h3>
      <TeammateDefaults
        draft={draft}
        providers={setup.data?.providers ?? []}
        onChange={(defaults) => onChange({ ...draft, ...defaults })}
      />
      <TeammateProject
        projectIds={draft.projectIds}
        onChange={(projectIds) => onChange({ ...draft, projectIds })}
      />
    </>
  );
}
