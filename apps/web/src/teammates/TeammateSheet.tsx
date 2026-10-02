import './teammate-sheet.css';
import { useEffect, useId, useRef, useState, type FormEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  TEAMMATE_INSTRUCTIONS_MAX,
  TEAMMATE_NAME_MAX,
  TEAMMATE_ROLE_MAX,
  type Teammate,
} from '@spark-outpost/contracts';
import { queryKeys } from '../api/client.ts';
import { setupApi, setupKey } from '../api/setup.ts';
import { useProjects } from '../chat/project/use-chat-repos.ts';
import { ChoicePicker } from '../ui/ChoicePicker.tsx';
import { wrapTabFocus } from '../ui/focus-trap.ts';
import { HoldToConfirm } from '../ui/HoldToConfirm.tsx';
import { XIcon } from '../ui/icons.tsx';
import { reveal } from '../ui/transitions.tsx';
import { FacePicker } from './FacePicker.tsx';
import { TeammateDefaults } from './TeammateDefaults.tsx';
import { TeammateFace } from './TeammateFace.tsx';
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

const NO_PROJECT = '';
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
  const [draft, setDraft] = useState<TeammateDraft>(() =>
    editing ? draftOf(editing) : newDraft(request.kind === 'create' ? request.seed : undefined),
  );
  const [touched, setTouched] = useState(false);
  const setup = useQuery({ queryKey: setupKey, queryFn: setupApi.get });
  const projects = useProjects();
  const save = useSave(editing);
  useSheetKeys(panelRef);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    nameRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  const problem = draftProblem(draft);
  const unchanged = editing !== null && Object.keys(changesFrom(editing, draft)).length === 0;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!problem && !unchanged) save.mutate(draft);
  };
  const used = draft.instructions.length;
  const projectChoices = [
    { id: NO_PROJECT, label: 'No project', description: 'Chats start without a linked folder.' },
    ...(projects.data ?? []).map((project) => ({ id: project.id, label: project.name })),
  ];

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
            <FacePicker face={shownFace(draft)} onChange={(face) => setDraft({ ...draft, face })} />
            <h3 className="tm-sub">Defaults for its chats</h3>
            <TeammateDefaults
              draft={draft}
              providers={setup.data?.providers ?? []}
              onChange={(defaults) => setDraft({ ...draft, ...defaults })}
            />
            <div className="field">
              <span>Default project</span>
              <ChoicePicker
                label="Default project"
                choices={projectChoices}
                value={draft.projectIds[0] ?? NO_PROJECT}
                onChange={(id) => setDraft({ ...draft, projectIds: id ? [id] : [] })}
              />
            </div>
            <label className="field">
              <span>Standing instructions</span>
              <textarea
                className="inp tm-instructions"
                rows={6}
                value={draft.instructions}
                placeholder="Review for bugs and missing tests. Point to the file and line."
                aria-describedby={`${titleId}-count`}
                onChange={(event) => setDraft({ ...draft, instructions: event.target.value })}
              />
              <small
                id={`${titleId}-count`}
                className={used > TEAMMATE_INSTRUCTIONS_MAX ? 'tm-count over' : 'tm-count'}
              >
                Added to every chat with this Spark as your own instructions. {used} /{' '}
                {TEAMMATE_INSTRUCTIONS_MAX}
              </small>
            </label>
            {editing && (
              <div className="tm-danger">
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
