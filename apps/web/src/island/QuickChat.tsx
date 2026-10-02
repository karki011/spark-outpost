import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  AUTONOMY_LEVELS,
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
import { FolderDialog } from '../chat/project/FolderDialog.tsx';
import { PanelTabs } from './PanelTabs.tsx';
import { ProjectMenu } from './ProjectMenu.tsx';
import { AttachmentChips } from '../chat/attachments/AttachmentChips.tsx';
import type { AttachmentsState } from '../chat/attachments/use-attachments.ts';
import type { useAddProject } from './use-add-project.ts';
import type { Panel } from './island-model.ts';

export interface QuickDraft {
  text: string;
  projectId: string | null | undefined;
  level: InvolvementLevel | null;
}

export interface Compose {
  attachments: AttachmentsState;
  adder: ReturnType<typeof useAddProject>;
  added: { project: Project; signal: number } | null;
  note: string | null;
}

interface QuickChatProps {
  compose: Compose;
  draftId: string;
  draft: QuickDraft;
  followUp: ConversationSummary | null;
  projects: readonly Project[];
  waiting: number;
  focusDelay: number;
  onDraft: (draft: QuickDraft) => void;
  onTab: (panel: Panel) => void;
  onSent: (chatId: string, title: string, project: string | null) => void;
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
  const level = draft.level ?? defaults.level ?? 'hands-off';
  const levelInfo = AUTONOMY_LEVELS.find((info) => info.id === level) ?? AUTONOMY_LEVELS[1]!;
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
      await api.sendMessage(draftId, crypto.randomUUID(), content, attachmentIds);
      return { id: draftId, title: titleFromMessage(content) };
    },
    onSuccess: ({ id, title }) => {
      onDraft({ ...draft, text: '' });
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

  const pick = (id: string | null) => {
    onDraft({ ...draft, projectId: id });
    setMenu(false);
    textRef.current?.focus({ preventScroll: true });
  };

  const cycleLevel = () => {
    const index = AUTONOMY_LEVELS.findIndex((info) => info.id === level);
    onDraft({ ...draft, level: AUTONOMY_LEVELS[(index + 1) % AUTONOMY_LEVELS.length]!.id });
  };

  return (
    <div className="isl-body">
      <PanelTabs panel="quick" waiting={props.waiting} onTab={props.onTab} />
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
          adding={adder.adding}
          error={adder.error}
          chipRef={chipRef}
          onPick={pick}
          onAdd={() => void adder.start()}
          onClose={() => setMenu(false)}
        />
      )}
      {adder.browsing && (
        <FolderDialog
          linking={adder.adding}
          error={adder.error}
          onUse={adder.linkFolder}
          onClose={adder.close}
        />
      )}
      {send.isError && (
        <p className="isl-err" role="alert">
          {send.error.message}
        </p>
      )}
    </div>
  );
}
