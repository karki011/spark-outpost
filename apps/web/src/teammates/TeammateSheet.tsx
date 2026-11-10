import './teammate-sheet.css';
import { useEffect, useId, useRef, useState, type FormEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TEAMMATE_NAME_MAX, TEAMMATE_ROLE_MAX, type Teammate } from '@spark-outpost/contracts';
import { queryKeys } from '../api/client.ts';
import { setupApi, setupKey } from '../api/setup.ts';
import { wrapTabFocus } from '../ui/focus-trap.ts';
import { HoldToConfirm } from '../ui/HoldToConfirm.tsx';
import { XIcon } from '../ui/icons.tsx';
import { reveal } from '../ui/transitions.tsx';
import { TeammateDefaults } from './TeammateDefaults.tsx';
import { TeammateFace } from './TeammateFace.tsx';
import { TeammateInstructions } from './TeammateInstructions.tsx';
import { TeammateLook } from './TeammateLook.tsx';
import { TeammateProject } from './TeammateProject.tsx';
import {
  changesFrom,
  createRequest,
  draftOf,
  draftProblem,
  newDraft,
  shownFace,
  type TeammateDraft,
} from './teammate-draft.ts';
import { closeTeammateSheet, requestTeammateDelete, type SheetRequest } from './teammate-store.ts';
import { teammateKeys, teammatesApi } from './teammates-api.ts';

const FOCUSABLE = 'button:not(:disabled), input, textarea, [tabindex="0"]';

interface TeammateSheetProps {
  request: SheetRequest;
  editing: Teammate | null;
}

function useSave(editing: Teammate | null) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (draft: TeammateDraft) =>
      editing
        ? teammatesApi.update(editing.id, changesFrom(editing, draft))
        : teammatesApi.create(createRequest(draft)),
    onSuccess: async () => {
      closeTeammateSheet();
      await Promise.all([
        client.invalidateQueries({ queryKey: teammateKeys.all }),
        client.invalidateQueries({ queryKey: queryKeys.conversations, exact: true }),
      ]);
    },
  });
}

function useSheetKeys(panel: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (document.querySelector('.fdlg')) return;
      if (event.key === 'Escape') {
        if (document.querySelector('.choice-menu.open')) return;
        event.stopPropagation();
        closeTeammateSheet();
        return;
      }
      wrapTabFocus(event, () => [
        ...(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []),
      ]);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [panel]);
}

export function TeammateSheet({ request, editing }: TeammateSheetProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const dangerRef = useRef<HTMLDivElement>(null);
  const toDelete = request.kind === 'edit' && request.focus === 'delete';
  const [draft, setDraft] = useState<TeammateDraft>(() =>
    editing ? draftOf(editing) : newDraft(request.kind === 'create' ? request.seed : undefined),
  );
  const [touched, setTouched] = useState(false);
  const setup = useQuery({ queryKey: setupKey, queryFn: setupApi.get });
  const save = useSave(editing);
  useSheetKeys(panelRef);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const hold = toDelete ? dangerRef.current?.querySelector('button') : null;
    if (hold) {
      hold.scrollIntoView({ block: 'center' });
      hold.focus({ preventScroll: true });
    } else nameRef.current?.focus();
    return () => previous?.focus?.();
  }, [toDelete]);

  const problem = draftProblem(draft);
  const unchanged = editing !== null && Object.keys(changesFrom(editing, draft)).length === 0;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!problem && !unchanged) save.mutate(draft);
  };

  return createPortal(
    <motion.div
      className="tm-scrim"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={reveal}
      onClick={(event) => {
        if (event.target === event.currentTarget) closeTeammateSheet();
      }}
    >
      <motion.div
        ref={panelRef}
        className="tm-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        initial={{ opacity: 0, x: 24 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 16 }}
        transition={reveal}
      >
        <header className="tm-sheet-h">
          <span className="tm-preview" aria-hidden="true">
            <TeammateFace face={shownFace(draft)} size={52} state="done" />
          </span>
          <h2 id={titleId}>{editing ? `Edit ${editing.name}` : 'New Spark'}</h2>
          <button
            type="button"
            className="icon-btn"
            aria-label="Close"
            onClick={closeTeammateSheet}
          >
            <XIcon />
          </button>
        </header>
        <form className="tm-form" onSubmit={submit} noValidate>
          <div className="tm-body">
            {editing?.kind && (
              <p className="tm-builtin">
                Spark's built-in pull request follow-up Spark. Its standing instructions go into
                every follow-up round as context and grant nothing; Follow up on pull requests in
                Settings decides whether rounds run.
              </p>
            )}
            <label className="field">
              <span>Name</span>
              <input
                ref={nameRef}
                className="inp"
                value={draft.name}
                maxLength={TEAMMATE_NAME_MAX}
                placeholder="Pip"
                aria-invalid={touched && !draft.name.trim()}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </label>
            <label className="field">
              <span>Role</span>
              <input
                className="inp"
                value={draft.role}
                maxLength={TEAMMATE_ROLE_MAX}
                placeholder="Frontend helper"
                onChange={(event) => setDraft({ ...draft, role: event.target.value })}
              />
            </label>
            <TeammateLook
              picked={draft.face}
              shown={shownFace(draft)}
              onChange={(face) => setDraft({ ...draft, face })}
            />
            <h3 className="tm-sub">Defaults for its chats</h3>
            <TeammateDefaults
              draft={draft}
              providers={setup.data?.providers ?? []}
              onChange={(defaults) => setDraft({ ...draft, ...defaults })}
            />
            <TeammateProject
              projectIds={draft.projectIds}
              onChange={(projectIds) => setDraft({ ...draft, projectIds })}
            />
            <TeammateInstructions
              instructions={draft.instructions}
              path={draft.instructionsPath}
              onInstructions={(instructions) => setDraft({ ...draft, instructions })}
              onPath={(instructionsPath) => setDraft({ ...draft, instructionsPath })}
            />
            {editing && (
              <div ref={dangerRef} className="tm-danger">
                <HoldToConfirm
                  label={`Hold to delete ${editing.name}`}
                  hint="Its chats stay and lose the link. You get 10 seconds to undo."
                  holdingHint="Keep holding. Let go now to cancel."
                  releasedHint="Released early. Nothing happened."
                  onConfirm={() => requestTeammateDelete({ id: editing.id, name: editing.name })}
                />
              </div>
            )}
          </div>
          <footer className="tm-foot">
            {((touched && problem) || save.error) && (
              <p className="tm-error" role="alert">
                {(touched && problem) || save.error?.message}
              </p>
            )}
            <button type="button" className="btn ghost sm" onClick={closeTeammateSheet}>
              Cancel
            </button>
            <button type="submit" className="btn primary sm" disabled={save.isPending || unchanged}>
              {editing ? 'Save' : 'Create Spark'}
            </button>
          </footer>
        </form>
      </motion.div>
    </motion.div>,
    document.body,
  );
}
