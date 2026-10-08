import { useRef, useState, type FormEvent } from 'react';
import { useIsMutating, useQuery, useQueryClient } from '@tanstack/react-query';
import { conversationSummarySchema, type ChatSettings } from '@spark-outpost/contracts';
import { api, capabilitiesQuery, forgetDraft, queryKeys, request } from '../api/client.ts';
import { ProjectFolders } from '../chat/project/ProjectFolders.tsx';
import { chatReposMutationKey, useLinkedProjects } from '../chat/project/use-chat-repos.ts';
import { usePopover } from '../ui/use-popover.ts';
import { ChoicePicker } from '../ui/ChoicePicker.tsx';
import { SecretWarning } from '../ui/SecretWarning.tsx';
import { useSecretGuard } from '../ui/use-secret-guard.ts';
import { nativeTerminalApi } from './terminal-api.ts';
import type { SessionChoice } from './SessionTypePicker.tsx';

export function NewTerminalSession({
  conversationId,
  choice,
  projectIds,
  settings,
  connected,
  onStarting,
  onLaunched,
  onFailed,
}: {
  conversationId: string;
  choice: SessionChoice;
  projectIds: string[];
  settings: ChatSettings | null;
  connected: boolean;
  onStarting?: () => void;
  onLaunched?: () => void;
  onFailed?: (created: boolean) => void;
}) {
  const client = useQueryClient();
  const repos = useLinkedProjects(projectIds);
  const folders = usePopover<HTMLButtonElement, HTMLDivElement>();
  const folderPending = useIsMutating({ mutationKey: chatReposMutationKey(conversationId) }) > 0;
  const capabilities = useQuery({
    ...capabilitiesQuery(choice.terminalProvider),
    enabled: connected,
  });
  const [modes, setModes] = useState<Record<string, string>>({});
  const selectedMode = !connected
    ? ''
    : (modes[choice.terminalProvider] ??
      (settings?.provider === choice.terminalProvider ? settings.agentMode : null) ??
      capabilities.data?.defaultMode ??
      '');
  const [prompt, setPrompt] = useState('');
  const promptInput = useRef<HTMLTextAreaElement>(null);
  const secrets = useSecretGuard(prompt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const message = useRef<{ id: string; prompt: string } | null>(null);
  const start = async (event?: FormEvent) => {
    event?.preventDefault();
    if (
      !prompt.trim() ||
      busy ||
      folderPending ||
      (choice.terminalProvider === 'codex' && selectedMode === 'ask-every-action')
    )
      return;
    if (secrets.blocks(prompt)) return;
    if (message.current?.prompt !== prompt) message.current = { id: crypto.randomUUID(), prompt };
    const messageId = message.current.id;
    setBusy(true);
    onStarting?.();
    setError(null);
    let created = false;
    try {
      await request(conversationSummarySchema, '/conversations', {
        method: 'POST',
        body: JSON.stringify({
          id: conversationId,
          ...choice,
          projectIds,
        }),
      });
      created = true;
      forgetDraft(conversationId);
      if (connected && selectedMode)
        await api.updateChatSettings(conversationId, {
          provider: choice.terminalProvider,
          agentMode: selectedMode,
        });
      await nativeTerminalApi.launch(conversationId, {
        provider: choice.terminalProvider,
        prompt,
        messageId,
      });
      await Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.conversation(conversationId) }),
        client.invalidateQueries({ queryKey: queryKeys.conversations }),
      ]);
      onLaunched?.();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'The terminal could not start.');
      setBusy(false);
      onFailed?.(created);
    }
  };
  return (
    <form className="native-new" onSubmit={(event) => void start(event)}>
      <h2>Work in your terminal</h2>
      <p>
        The real {choice.terminalProvider === 'claude' ? 'Claude Code' : 'Codex'} interface, with
        Spark tools and your project context.
      </p>
      <fieldset className="native-context" disabled={busy} aria-label="Terminal settings">
        <ProjectFolders conversationId={conversationId} repos={repos} popover={folders} />
        {connected && (capabilities.data?.modes.length ?? 0) > 0 && (
          <ChoicePicker
            label="Agent mode"
            choices={capabilities
              .data!.modes.filter(
                (mode) => choice.terminalProvider !== 'codex' || mode.id !== 'ask-every-action',
              )
              .map((mode) => ({ id: mode.id, label: mode.label }))}
            value={selectedMode}
            onChange={(mode) => setModes({ ...modes, [choice.terminalProvider]: mode })}
          />
        )}
        {choice.terminalProvider === 'codex' && selectedMode === 'ask-every-action' && (
          <p role="status">
            Ask every time is unavailable in this Codex terminal. Choose Read-only, Approve for me,
            or Full access above, or use Chat.
          </p>
        )}
      </fieldset>
      <label htmlFor={`terminal-prompt-${conversationId}`}>What would you like to work on?</label>
      <SecretWarning
        guard={secrets}
        input={promptInput}
        onText={setPrompt}
        onSendAnyway={() => void start()}
      />
      <textarea
        ref={promptInput}
        id={`terminal-prompt-${conversationId}`}
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        rows={4}
        disabled={busy}
      />
      {connected && capabilities.isError && (
        <p className="native-note">
          Agent modes could not be loaded. The native terminal can still start with its default
          mode.
        </p>
      )}
      {error && (
        <p role="alert" className="error-line">
          {error}
        </p>
      )}
      <button
        className="btn primary"
        disabled={
          busy ||
          folderPending ||
          !prompt.trim() ||
          (choice.terminalProvider === 'codex' && selectedMode === 'ask-every-action')
        }
      >
        {busy ? 'Starting terminal…' : folderPending ? 'Linking folder…' : 'Start terminal'}
      </button>
      <small>
        Linked folders open in this session’s worktree. Native commands use the agent’s permissions.
        Terminal sessions do not automatically open pull requests.
      </small>
    </form>
  );
}
