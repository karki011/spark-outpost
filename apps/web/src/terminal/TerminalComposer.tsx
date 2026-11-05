import '../chat/composer.css';
import '../chat/composer/composer-popovers.css';
import '../chat/project/project.css';
import { useId, useRef, useState, type ReactNode } from 'react';
import { useIsMutating, useQuery } from '@tanstack/react-query';
import {
  isTrackedTerminalProvider,
  terminalProviderName,
  terminalStartText,
  type ChatSettings,
} from '@spark-outpost/contracts';
import { CAPABILITIES_STALE_MS, capabilitiesQuery } from '../api/client.ts';
import { ComposerShell, composerRows } from '../chat/composer/ComposerShell.tsx';
import { useChatDraft } from '../chat/composer/use-chat-draft.ts';
import { SendButton } from '../chat/composer/SendButton.tsx';
import { ProjectFolders } from '../chat/project/ProjectFolders.tsx';
import { chatReposMutationKey, useLinkedProjects } from '../chat/project/use-chat-repos.ts';
import { SecretWarning } from '../ui/SecretWarning.tsx';
import { usePopover } from '../ui/use-popover.ts';
import { useSecretGuard } from '../ui/use-secret-guard.ts';
import type { SessionChoice } from './SessionTypePicker.tsx';
import { TerminalAgentPicker } from './TerminalAgentPicker.tsx';
import { CODEX_ASK_UNAVAILABLE, UNTRACKED_NOTE, terminalModeBlocked } from './terminal-agents.ts';
import { nativeTerminalApi, terminalStartKey } from './terminal-api.ts';
import { useTerminalStart, type TerminalStartEvents } from './use-terminal-start.ts';

const PROMPT_LABEL = 'What would you like to work on?';
const PULL_REQUEST_HINT = 'Terminal sessions don’t open pull requests automatically';
const WORKTREE_HINT = 'Linked folders open in this session’s worktree.';
const IN_PLACE_HINT = 'This agent works in your linked folder, not in a worktree of its own.';

interface TerminalComposerProps extends TerminalStartEvents {
  conversationId: string;
  choice: SessionChoice;
  onChoice: (choice: SessionChoice) => void;
  projectIds: string[];
  settings: ChatSettings | null;
  connected: boolean;
  sessionPicker?: ReactNode;
}

export function TerminalComposer({
  conversationId,
  choice,
  onChoice,
  projectIds,
  settings,
  connected,
  sessionPicker = null,
  onStarting,
  onLaunched,
  onFailed,
}: TerminalComposerProps) {
  const provider = choice.terminalProvider;
  const tracked = isTrackedTerminalProvider(provider) ? provider : null;
  const agentName = terminalProviderName(provider);
  const folderHint = tracked ? WORKTREE_HINT : IN_PLACE_HINT;
  const repos = useLinkedProjects(projectIds);
  const folders = usePopover<HTMLButtonElement, HTMLDivElement>();
  const folderPending = useIsMutating({ mutationKey: chatReposMutationKey(conversationId) }) > 0;
  const capabilities = useQuery({
    ...capabilitiesQuery(tracked ?? 'claude'),
    staleTime: CAPABILITIES_STALE_MS,
    enabled: connected && tracked !== null,
  });
  const [modes, setModes] = useState<Record<string, string>>({});
  const mode =
    connected && tracked
      ? (modes[provider] ??
        (settings?.provider === provider ? settings.agentMode : null) ??
        capabilities.data?.defaultMode ??
        null)
      : null;
  const [prompt, setPrompt] = useChatDraft(`terminal:${conversationId}`);
  const promptInput = useRef<HTMLTextAreaElement>(null);
  const inputId = useId();
  const secrets = useSecretGuard(prompt);
  const launch = useTerminalStart({
    onStarting,
    onLaunched: () => {
      setPrompt('');
      onLaunched?.();
    },
    onFailed,
  });
  const blocked = terminalModeBlocked(provider, mode);
  const ready =
    (!tracked || prompt.trim().length > 0) && !launch.busy && !folderPending && !blocked;
  const start = () => {
    if (!ready || (tracked && secrets.blocks(prompt))) return;
    void launch.start({
      conversationId,
      choice,
      projectIds,
      agentMode: mode,
      prompt: tracked ? prompt : '',
    });
  };
  const startPhase = useQuery({
    queryKey: terminalStartKey(conversationId),
    queryFn: () => nativeTerminalApi.startPhase(conversationId),
    enabled: launch.busy,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const pending = launch.busy
    ? terminalStartText(startPhase.data?.phase ?? null, agentName)
    : folderPending
      ? 'Linking folder…'
      : null;
  return (
    <>
      <div className="thread-wrap">
        <div className="thread">
          <div className="empty native-intro">
            <h2>Work in your terminal</h2>
            <p>
              {tracked
                ? `The real ${agentName} interface, with Spark tools and your project context.`
                : `The real ${agentName} interface. ${UNTRACKED_NOTE}`}
            </p>
          </div>
        </div>
      </div>
      <ComposerShell
        error={launch.error}
        warning={
          <SecretWarning
            guard={secrets}
            input={promptInput}
            onText={setPrompt}
            onSendAnyway={start}
          />
        }
        foot={
          <>
            <ProjectFolders conversationId={conversationId} repos={repos} popover={folders}>
              <span className="ctx-unlinked" title={folderHint}>
                {folderHint}
              </span>
            </ProjectFolders>
            {sessionPicker}
          </>
        }
        bar={
          <>
            <span className="hint shown" title={`${PULL_REQUEST_HINT}.`}>
              {PULL_REQUEST_HINT}
            </span>
            <TerminalAgentPicker
              provider={provider}
              onProvider={(next) => onChoice({ ...choice, terminalProvider: next })}
              capabilities={capabilities.data}
              loading={connected && capabilities.isPending}
              mode={mode}
              onMode={(next) => setModes({ ...modes, [provider]: next })}
              disabled={launch.busy}
            />
            <SendButton
              busy={false}
              label={pending ?? 'Start terminal'}
              disabled={!ready}
              onSend={start}
              onStop={() => undefined}
            />
          </>
        }
      >
        <p className="composer-notice" role="status">
          {pending}
        </p>
        {blocked && (
          <p className="composer-notice" role="status">
            {CODEX_ASK_UNAVAILABLE}
          </p>
        )}
        {connected && tracked && capabilities.isError && (
          <p className="composer-notice" role="status">
            Agent modes could not be loaded. The native terminal can still start with its default
            mode.
          </p>
        )}
        {tracked && (
          <label className="sr-only" htmlFor={inputId}>
            {PROMPT_LABEL}
          </label>
        )}
        {tracked && (
          <textarea
            ref={promptInput}
            id={inputId}
            autoFocus
            value={prompt}
            rows={composerRows(prompt)}
            placeholder={PROMPT_LABEL}
            disabled={launch.busy}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
              event.preventDefault();
              start();
            }}
          />
        )}
      </ComposerShell>
    </>
  );
}
