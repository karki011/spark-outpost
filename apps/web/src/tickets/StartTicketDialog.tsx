import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ticketSourceNames, type TicketStartMode } from '@spark-outpost/contracts';
import { queryKeys } from '../api/client.ts';
import { projectKeys, projectsApi } from '../api/projects.ts';
import { FolderDialog } from '../chat/project/FolderDialog.tsx';
import { CloseIcon } from '../tasks/TaskIcons.tsx';
import { ChoicePicker } from '../ui/ChoicePicker.tsx';
import { wrapTabFocus } from '../ui/focus-trap.ts';
import { Segmented } from '../ui/Segmented.tsx';
import { reveal } from '../ui/transitions.tsx';
import type { DetailTicket } from './TicketDetail.tsx';
import { ticketKeys, ticketsApi } from './tickets-api.ts';
import { BlobToggle } from '../brand/BlobToggle.tsx';
import { StartContext } from './StartContext.tsx';
import { useStartContext } from './use-start-context.ts';

interface StartTicketDialogProps {
  ticket: DetailTicket;
  onClose: () => void;
  onStarted: (conversationId: string) => void;
}

const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]):not([hidden]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const NO_PROJECT = '';

const MODES = [
  { id: 'plan', label: 'Plan first' },
  { id: 'build', label: 'Build' },
];

export function StartTicketDialog({ ticket, onClose, onStarted }: StartTicketDialogProps) {
  const titleId = useId();
  const queryClient = useQueryClient();
  const panelRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<TicketStartMode>('plan');
  const [projectId, setProjectId] = useState(NO_PROJECT);
  const [move, setMove] = useState(true);
  const [assign, setAssign] = useState(!ticket.mine);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [contextOpen, setContextOpen] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const context = useStartContext();
  const addFolderRef = useRef<HTMLElement | null>(null);
  const projects = useQuery({ queryKey: projectKeys.all, queryFn: projectsApi.list });
  const source = ticketSourceNames[ticket.source];
  const owner = ticket.assignedTo && !ticket.mine ? ticket.assignedTo.name : null;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')?.focus();
    return () => opener?.focus();
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && !busy) {
      event.stopPropagation();
      onClose();
      return;
    }
    const panel = event.currentTarget;
    wrapTabFocus(event, () => [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)]);
  };

  const start = async (allowSecrets = false) => {
    if (context.hold) return;
    if (!allowSecrets && context.secrets.blocks(context.note.trim())) {
      setContextOpen(true);
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      if (assign && !ticket.mine) {
        await ticketsApi.assign(ticket.source, ticket.key, {
          to: 'me',
          expectedAssigneeId: ticket.assignedTo?.id ?? null,
          confirmTakeover: true,
        });
      }
      const conversationId = crypto.randomUUID();
      await ticketsApi.start(ticket.source, ticket.key, {
        conversationId,
        messageId: crypto.randomUUID(),
        mode,
        moveToInProgress: move,
        ...context.request(),
        ...(projectId ? { projectId } : {}),
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.conversations }),
        queryClient.invalidateQueries({ queryKey: ticketKeys.all }),
      ]);
      onStarted(conversationId);
    } catch (error) {
      setProblem((error as Error).message);
      setBusy(false);
    }
  };

  const projectChoices = [
    { id: NO_PROJECT, label: 'No project folder' },
    ...(projects.data ?? []).map((project) => ({ id: project.id, label: project.name })),
  ];

  const closeFolders = () => {
    setBrowsing(false);
    addFolderRef.current?.focus();
  };

  const browseFolders = () => {
    addFolderRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setBrowsing(true);
  };

  const projectRoot = projects.data?.find((project) => project.id === projectId)?.rootPath ?? null;

  return (
    <>
      <div
        className="dlg"
        onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}
      >
        <motion.div
          ref={panelRef}
          className="dlg-panel tk-start"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          initial={{ opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={reveal}
          onKeyDown={onKeyDown}
        >
          <div className="dlg-head">
            <div>
              <h3 id={titleId}>Start work on {ticket.key}</h3>
              <small>{ticket.title}</small>
            </div>
            <button
              type="button"
              className="icon-btn"
              aria-label="Close"
              onClick={onClose}
              disabled={busy}
            >
              <CloseIcon />
            </button>
          </div>
          <div className="dlg-body">
            <p className="dlabel">How to start</p>
            <Segmented
              ariaLabel="How to start"
              options={MODES}
              value={mode}
              onChange={(id) => setMode(id as TicketStartMode)}
            />
            <p className="dlabel">Project folder</p>
            <ChoicePicker
              label="Project folder"
              choices={projectChoices}
              value={projectId}
              onChange={setProjectId}
            />
            <label className="check-row">
              <BlobToggle
                size="sm"
                label={`Move ${ticket.key} to In progress in ${source}`}
                checked={move}
                onChange={setMove}
              />
              Move {ticket.key} to In progress in {source}
            </label>
            {!ticket.mine && (
              <label className="check-row">
                <BlobToggle
                  size="sm"
                  label={
                    owner
                      ? `Take ${ticket.key} from ${owner} and assign it to me in ${source}`
                      : `Assign ${ticket.key} to me in ${source}`
                  }
                  checked={assign}
                  onChange={setAssign}
                />
                {owner
                  ? `Take ${ticket.key} from ${owner} and assign it to me in ${source}`
                  : `Assign ${ticket.key} to me in ${source}`}
              </label>
            )}
            <StartContext
              context={context}
              open={contextOpen}
              onToggle={() => setContextOpen(!contextOpen)}
              onBrowseFolder={browseFolders}
              onSendAnyway={() => void start(true)}
            />
            {problem && (
              <p className="tk-cform-err" role="alert">
                {problem}
              </p>
            )}
          </div>
          <div className="dlg-foot">
            <span className="why">
              {context.hold ?? `Creates a chat and links ${ticket.key} to it.`}
            </span>
            <button type="button" className="btn ghost sm" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              className="btn primary sm"
              onClick={() => void start()}
              disabled={busy || context.hold !== null}
            >
              {busy ? 'Starting…' : mode === 'plan' ? 'Start with a plan' : 'Start building'}
            </button>
          </div>
        </motion.div>
      </div>
      <AnimatePresence>
        {browsing && (
          <FolderDialog
            purpose="reference"
            startPath={projectRoot}
            linking={false}
            error={null}
            onUse={(path) => {
              context.addFolder(path);
              closeFolders();
            }}
            onClose={closeFolders}
          />
        )}
      </AnimatePresence>
    </>
  );
}
