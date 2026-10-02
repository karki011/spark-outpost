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
import { NO_FOLDER_NOTE, permissionState } from '../chat/composer/mode-summary.ts';
import { PermissionIcon } from '../chat/composer/PermissionChip.tsx';
import { providerName } from '../chat/provider-name.ts';
import { SecretWarning } from '../ui/SecretWarning.tsx';
import { useSecretGuard } from '../ui/use-secret-guard.ts';
import { PanelTabs } from './PanelTabs.tsx';
import type { Panel } from './island-model.ts';

export interface QuickDraft {
  text: string;
  projectId: string | null | undefined;
  level: InvolvementLevel | null;
}

interface QuickChatProps {
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
  const [menu, setMenu] = useState(false);
  const secrets = useSecretGuard(draft.text);
  const defaults = useDefaults();
  const level = draft.level ?? defaults.level ?? 'hands-off';
  const levelInfo = AUTONOMY_LEVELS.find((info) => info.id === level) ?? AUTONOMY_LEVELS[1]!;
  const project = projects.find((candidate) => candidate.id === draft.projectId) ?? null;
  const permission = defaults.settings
    ? permissionState(defaults.settings, defaults.capabilities, project !== null)
    : null;

  useEffect(() => {
    const timer = setTimeout(
      () => textRef.current?.focus({ preventScroll: true }),
      props.focusDelay,
    );
    return () => clearTimeout(timer);
  }, [props.focusDelay, followUp]);

  const send = useMutation({
    mutationFn: async (content: string) => {
      if (followUp) {
        await api.sendMessage(followUp.id, crypto.randomUUID(), content);
        return { id: followUp.id, title: followUp.title };
      }
      await api.updateChatSettings(draftId, {
        projectIds: draft.projectId ? [draft.projectId] : [],
        level,
      });
      await api.sendMessage(draftId, crypto.randomUUID(), content);
      return { id: draftId, title: titleFromMessage(content) };
    },
    onSuccess: ({ id, title }) => {
      onDraft({ ...draft, text: '' });
      onSent(id, title, project?.name ?? null);
    },
  });

  const submit = () => {
    const content = draft.text.trim();
    if (!content || send.isPending || secrets.blocks(draft.text)) return;
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

  const options = [
    ...projects.map((item) => ({ id: item.id, name: item.name, path: item.displayPath })),
    { id: null, name: 'No project', path: 'Chat only, no files' },
  ];

  return (
    <div className="isl-body">
      <PanelTabs panel="quick" waiting={props.waiting} onTab={props.onTab} />
      <div className="isl-qc">
        {followUp && (
          <div className="isl-qctx">
            Following up in <b>{followUp.title}</b>
          </div>
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
          <span className="isl-qc-hint">{send.isPending ? 'Sending…' : ''}</span>
          <span className="isl-sp" />
          {!followUp && (
            <button
              ref={chipRef}
              type="button"
              className="isl-chip"
              aria-haspopup="menu"
              aria-expanded={menu}
              aria-controls="isl-qmenu"
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
              title={
                permission.noFolder
                  ? NO_FOLDER_NOTE
                  : 'Agent permissions, change the default in Spark settings'
              }
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
          <button
            type="button"
            className="isl-send"
            aria-label="Send"
            disabled={!draft.text.trim() || send.isPending}
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
      {menu && (
        <div
          className="isl-menu"
          id="isl-qmenu"
          role="menu"
          aria-label="Choose project"
          onKeyDown={(event) => {
            const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
            const at = items.indexOf(document.activeElement as HTMLButtonElement);
            if (event.key === 'ArrowDown') items[(at + 1) % items.length]?.focus();
            else if (event.key === 'ArrowUp')
              items[(at - 1 + items.length) % items.length]?.focus();
            else if (event.key === 'Escape') {
              setMenu(false);
              chipRef.current?.focus();
            } else return;
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          {options.map((option, index) => (
            <button
              key={option.id ?? 'none'}
              type="button"
              role="menuitemradio"
              aria-checked={option.id === (draft.projectId ?? undefined)}
              autoFocus={index === 0}
              onClick={() => pick(option.id)}
            >
              <span className="check" aria-hidden="true">
                ✓
              </span>
              <span>{option.name}</span>
              <small>{option.path}</small>
            </button>
          ))}
        </div>
      )}
      {send.isError && (
        <p className="isl-err" role="alert">
          {send.error.message}
        </p>
      )}
    </div>
  );
}
