import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { TicketSourceId } from '@spark-outpost/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  AUTONOMY_LEVELS,
  DEFAULT_INVOLVEMENT_LEVEL,
  titleFromMessage,
  type ConversationSummary,
  type InvolvementLevel,
  type Project,
} from '@spark-outpost/contracts';
import { api, capabilitiesQuery } from '../api/client.ts';
import { shortLabel } from '../chat/composer/model-options.ts';
import { permissionState } from '../chat/composer/mode-summary.ts';
import { PermissionIcon } from '../chat/composer/PermissionChip.tsx';
import { PICK_PROJECT_HINT } from '../chat/project/repo-list.ts';
import { providerName } from '../chat/provider-name.ts';
import { SecretWarning } from '../ui/SecretWarning.tsx';
import { useSecretGuard } from '../ui/use-secret-guard.ts';
import { ProjectMenu } from './ProjectMenu.tsx';
import { AttachmentChips } from '../chat/attachments/AttachmentChips.tsx';
import type { AttachmentsState } from '../chat/attachments/use-attachments.ts';
import type { AddFolder } from '../projects/use-add-folder.tsx';
import { ticketsApi } from '../tickets/tickets-api.ts';
import type { TicketRef } from '../voice/commands.ts';
import { MicButton } from '../voice/MicButton.tsx';
import { useSeed } from '../voice/speech-seed.tsx';
import { joinDictation } from '../voice/use-dictation.ts';

export type FollowUp = Pick<ConversationSummary, 'id' | 'title'>;

export interface QuickDraft {
  text: string;
  projectId: string | null | undefined;
  level: InvolvementLevel | null;
}

export interface Compose {
  attachments: AttachmentsState;
  adder: AddFolder;
  added: { project: Project; signal: number } | null;
  note: string | null;
}

interface QuickChatProps {
  compose: Compose;
  draftId: string;
  draft: QuickDraft;
  followUp: FollowUp | null;
  projects: readonly Project[];
  focusDelay: number;
  onDraft: (draft: QuickDraft) => void;
  onSent: (chatId: string, title: string, project: string | null) => void;
  footer?: ReactNode;
}

function useDefaults() {
  const defaults = useQuery({ queryKey: ['chat-defaults'], queryFn: api.getChatDefaults });
  const provider = defaults.data?.provider ?? null;
  const capabilities = useQuery({
    ...capabilitiesQuery(provider ?? 'claude'),
    enabled: provider !== null,
  });
  const modelId = defaults.data?.model ?? capabilities.data?.defaultModel ?? null;
  const model = capabilities.data?.models.find((option) => option.id === modelId);
  return {
    provider,
    settings: defaults.data ?? null,
    capabilities: capabilities.data,
    level: defaults.data?.level ?? null,
    modelLabel: model ? shortLabel(model.label) : modelId,
  };
}

export function QuickChat(props: QuickChatProps) {
  const { draftId, draft, followUp, projects, onDraft, onSent } = props;
  const textRef = useRef<HTMLTextAreaElement>(null);
  const chipRef = useRef<HTMLButtonElement>(null);
  const { attachments, adder, added } = props.compose;
  const [menuAt, setMenuAt] = useState<number | null>(null);
  const menu = menuAt !== null && menuAt === (added?.signal ?? 0);
  const setMenu = (open: boolean) => setMenuAt(open ? (added?.signal ?? 0) : null);
  const secrets = useSecretGuard(draft.text);
  const defaults = useDefaults();
  const [ticket, setTicket] = useState<TicketRef | null>(null);
  const [moveTicket, setMoveTicket] = useState(true);
  const level = draft.level ?? defaults.level ?? DEFAULT_INVOLVEMENT_LEVEL;
  const levelInfo = AUTONOMY_LEVELS.find((info) => info.id === level) ?? AUTONOMY_LEVELS[0]!;
  const project =
    projects.find((candidate) => candidate.id === draft.projectId) ??
    (added && added.project.id === draft.projectId ? added.project : null);
  const permission = defaults.settings
    ? permissionState(defaults.settings, defaults.capabilities)
    : null;

  useEffect(() => {
    const timer = setTimeout(
      () => textRef.current?.focus({ preventScroll: true }),
      props.focusDelay,
    );
    return () => clearTimeout(timer);
  }, [props.focusDelay, followUp]);

  const attachmentIds = attachments.uploaded.map((attachment) => attachment.id);
  const ready = !attachments.uploading && !attachments.failed;

  const send = useMutation({
    mutationFn: async (content: string) => {
      if (followUp) {
        await api.sendMessage(followUp.id, crypto.randomUUID(), content, attachmentIds);
        return { id: followUp.id, title: followUp.title };
      }
      await api.updateChatSettings(draftId, {
        projectIds: draft.projectId ? [draft.projectId] : [],
        level,
      });
      if (ticket?.source) {
        const started = await ticketsApi.start(ticket.source as TicketSourceId, ticket.key, {
          conversationId: draftId,
          messageId: crypto.randomUUID(),
          ...(draft.projectId ? { projectId: draft.projectId } : {}),
          note: content,
          moveToInProgress: moveTicket,
          attachmentIds,
        });
        return { id: started.conversationId, title: `${ticket.key} ${started.ticket.title}` };
      }
      await api.sendMessage(draftId, crypto.randomUUID(), content, attachmentIds);
      return { id: draftId, title: titleFromMessage(content) };
    },
    onSuccess: ({ id, title }) => {
      onDraft({ ...draft, text: '' });
      setTicket(null);
      attachments.clear();
      onSent(id, title, project?.name ?? null);
    },
  });

  const submit = () => {
    const content = draft.text.trim();
    if (!content || !ready || send.isPending || secrets.blocks(draft.text)) return;
    send.mutate(content);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  };

  useSeed(
    'quick',
    (seed) => {
      onDraft({ ...draft, text: seed.text, projectId: seed.projectId });
      setTicket(seed.ticket);
      setMoveTicket(true);
    },
    submit,
  );

  useSeed(
    'reply',
    (seed) => {
      if (followUp?.id !== seed.chatId) return;
      onDraft({ ...draft, text: seed.text });
      textRef.current?.focus({ preventScroll: true });
    },
    submit,
  );

  const pick = (id: string | null) => {
    onDraft({ ...draft, projectId: id });
    setMenu(false);
    textRef.current?.focus({ preventScroll: true });
  };

  const cycleLevel = () => {
    const index = AUTONOMY_LEVELS.findIndex((info) => info.id === level);
    onDraft({ ...draft, level: AUTONOMY_LEVELS[(index + 1) % AUTONOMY_LEVELS.length]!.id });
  };

  if (adder.showing) {
    return <div className="isl-panel isl-picker">{adder.flow}</div>;
  }

  return (
    <div className="isl-panel">
      <div className="isl-qc">
        {followUp && (
          <div className="isl-qctx">
            Following up in <b>{followUp.title}</b>
          </div>
        )}
        {attachments.items.length > 0 && (
          <AttachmentChips
            items={attachments.items}
            onRemove={attachments.remove}
            onRetry={attachments.retry}
          />
        )}
        <SecretWarning
          guard={secrets}
          input={textRef}
          onText={(text) => onDraft({ ...draft, text })}
          onSendAnyway={submit}
        />
        {ticket && !followUp && (
          <div className="isl-qctx">
            <span className="isl-chip static">
              {ticket.key}
              {ticket.title ? ` ${ticket.title}` : ''}
              <button
                type="button"
                className="isl-btn link"
                aria-label={`Remove ticket ${ticket.key}`}
                onClick={() => setTicket(null)}
              >
                ×
              </button>
            </span>
            {ticket.source ? (
              <label>
                <input
                  type="checkbox"
                  checked={moveTicket}
                  onChange={(event) => setMoveTicket(event.target.checked)}
                />{' '}
                Move to In Progress
              </label>
            ) : (
              <span className="isl-sub">Not in a connected tracker; sends as a plain chat</span>
            )}
          </div>
        )}
        <label className="sr-only" htmlFor="isl-qc-text">
          Message
        </label>
        <textarea
          id="isl-qc-text"
          ref={textRef}
          rows={2}
          placeholder={followUp ? 'Reply…' : 'Start a new chat…'}
          value={draft.text}
          onChange={(event) => onDraft({ ...draft, text: event.target.value })}
          onKeyDown={onKeyDown}
        />
        <div className="isl-qc-bar">
          {!followUp && (
            <button
              ref={chipRef}
              type="button"
              className="isl-chip"
              aria-haspopup="menu"
              aria-expanded={menu}
              aria-controls="isl-qmenu"
              title={project ? undefined : PICK_PROJECT_HINT}
              onClick={() => setMenu(!menu)}
            >
              {draft.projectId === undefined ? 'Choose project' : (project?.name ?? 'No project')}
              <span className="car" aria-hidden="true">
                ▾
              </span>
            </button>
          )}
          {defaults.provider && (
            <span className="isl-chip static" title="Pinned model, change it in Spark settings">
              <span
                className="isl-pdot"
                style={{ ['--pc' as string]: `var(--c-${defaults.provider}, var(--faint))` }}
              />
              {defaults.modelLabel ?? providerName(defaults.provider)}
            </span>
          )}
          {!followUp && permission && (
            <span
              className={`isl-chip static isl-perm risk-${permission.risk}`}
              title="Agent mode, change the default in Spark settings"
            >
              <PermissionIcon risk={permission.risk} />
              {permission.short}
            </span>
          )}
          {!followUp && (
            <button
              type="button"
              className="isl-chip"
              title="Spark autonomy, click to change"
              aria-label={`Spark autonomy: ${levelInfo.label}`}
              onClick={cycleLevel}
            >
              {levelInfo.label}
            </button>
          )}
          <span className="isl-sp" />
          <span className="isl-qc-hint">
            {send.isPending ? 'Sending…' : attachments.uploading ? 'Uploading…' : ''}
          </span>
          <MicButton
            className="isl-chip"
            onText={(heard) => onDraft({ ...draft, text: joinDictation(draft.text, heard) })}
          />
          <button
            type="button"
            className="isl-send"
            aria-label="Send"
            disabled={!draft.text.trim() || !ready || send.isPending}
            onClick={submit}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M8 13V3M3.5 7.5 8 3l4.5 4.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              />
            </svg>
          </button>
        </div>
      </div>
      {(props.compose.note ?? attachments.notice) && (
        <p className="isl-qnote" role="status">
          {props.compose.note ?? attachments.notice}
        </p>
      )}
      {menu && (
        <ProjectMenu
          projects={projects}
          selected={draft.projectId}
          busy={adder.busy}
          error={adder.error}
          actions={adder.actions}
          chipRef={chipRef}
          onPick={pick}
          onAction={(action) => {
            setMenu(false);
            chipRef.current?.focus();
            action.onSelect();
          }}
          onClose={() => setMenu(false)}
        />
      )}
      {send.isError && (
        <p className="isl-err" role="alert">
          {send.error.message}
        </p>
      )}
      {props.footer}
    </div>
  );
}
