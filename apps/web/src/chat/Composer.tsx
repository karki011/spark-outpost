import './composer.css';
import './composer/composer-popovers.css';
import './project/project.css';
import { restoreFailedDraft, useChatDraft } from './composer/use-chat-draft.ts';
import { useCallback, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  DEFAULT_BUSY_ENTER,
  type AgentCommand,
  type BusyEnterAction,
  type RepoDefinition,
} from '@spark-outpost/contracts';
import { useQuery } from '@tanstack/react-query';
import { CAPABILITIES_STALE_MS, capabilitiesQuery } from '../api/client.ts';
import { usePopover } from '../ui/use-popover.ts';
import { AttachmentChips } from './attachments/AttachmentChips.tsx';
import { pasteContext } from './attachments/paste-context.ts';
import { ContextRing } from './composer/ContextRing.tsx';
import { ModelPicker } from './composer/ModelPicker.tsx';
import { SecretWarning } from '../ui/SecretWarning.tsx';
import { useSecretGuard } from '../ui/use-secret-guard.ts';
import {
  blockedMessage,
  clientCommand,
  effortHint,
  typedCommandNote,
  parseSlash,
  skillCommand,
  type ClientCommandName,
} from './composer/slash.ts';
import { runClientCommand } from './composer/client-commands.ts';
import { SlashMenu } from './composer/SlashMenu.tsx';
import { ChatMcpPanel } from './composer/ChatMcpPanel.tsx';
import { usePickerCommand } from './composer/use-picker-command.ts';
import { useSlash } from './composer/use-slash.ts';
import { usePluginCommands } from './composer/use-plugin-commands.ts';
import { useDraftRequests } from './composer/use-draft-requests.ts';
import { useUnsentWork } from './composer/unsent-work.ts';
import { PlusMenu } from './composer/PlusMenu.tsx';
import { SendButton } from './composer/SendButton.tsx';
import { ComposerShell, composerRows } from './composer/ComposerShell.tsx';
import { MicButton } from '../voice/MicButton.tsx';
import { useDictationDraft } from '../voice/use-dictation-draft.ts';
import {
  composerHint,
  composerPlaceholder,
  focusMovesToSlashMenu,
} from './composer/composer-hint.ts';
import { SparkSuggestion } from '../teammates/SparkSuggestion.tsx';
import { useMentionSparks } from '../teammates/use-mention-sparks.ts';
import { ContextBar } from './project/ContextBar.tsx';
import { MentionPicker } from './project/MentionPicker.tsx';
import { RepoFilePicker } from './project/RepoFilePicker.tsx';
import { useAgentConfig } from './project/use-agent-config.ts';
import { repoFileKey, type RepoFile } from './project/use-file-search.ts';
import { useMention } from './project/use-mention.ts';
import { enterAction } from './queue/send-choice.ts';
import { MarkdownInput } from './composer/markdown/MarkdownInput.tsx';
import { codeBlockEnter } from './composer/markdown/md-keys.ts';
import { QuoteChips } from './quotes/QuoteChips.tsx';
import { sendLabel } from './quotes/quote-text.ts';
import type { ComposerProps } from './composer/composer-props.ts';

const NO_COMMANDS: readonly AgentCommand[] = [];
const SEND_KEYS_TIP = 'Enter to send, Shift + Enter for a new line';
const NO_SKILLS: readonly RepoDefinition[] = [];

export function Composer({
  conversationId,
  repos,
  settings,
  providers,
  runs,
  usageTotals,
  busy,
  stopping = false,
  sending,
  ready = true,
  error,
  attachments,
  onSend,
  onStop,
  onQueue,
  onSendNow,
  busyEnter = DEFAULT_BUSY_ENTER,
  waitingOn = 0,
  waitingBackground = null,
  notice = null,
  above = null,
  onAudit,
  onStartFresh,
  agentCommands = NO_COMMANDS,
  agentName: givenAgentName,
  autoFocus = true,
  sessionChip = null,
  quotes,
}: ComposerProps) {
  const [draft, setDraft] = useChatDraft(conversationId);
  const [repoOpen, setRepoOpen] = useState(false);
  const [formatting, setFormatting] = useState(false);
  const [modeSlot, setModeSlot] = useState<HTMLSpanElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const voice = useDictationDraft(draft, setDraft, conversationId, () => {
    textareaRef.current?.focus({ preventScroll: true });
  });
  const lastChoice = useRef(busyEnter);
  const secrets = useSecretGuard(draft);
  const inputId = useId();
  const repoPopover = usePopover<HTMLButtonElement, HTMLDivElement>();
  const hasRepos = repos.length > 0;
  const addFromRepo = (file: RepoFile) => attachments.addFromRepo(file.projectId, file);
  const openRepoMenu = () => {
    repoPopover.setOpen(true);
    repoPopover.anchorRef.current?.focus();
  };
  const sparks = useMentionSparks(conversationId);
  const mention = useMention({
    repos,
    sparks,
    draft,
    setDraft,
    textareaRef,
    onPick: addFromRepo,
  });
  const [mcpOpen, setMcpOpen] = useState(false);
  const provider = settings?.provider ?? null;
  const providerLabel = providers.find((entry) => entry.id === provider)?.name;
  const agentName = givenAgentName ?? providerLabel ?? 'Agent';
  const capabilities = useQuery({
    ...capabilitiesQuery(provider ?? 'claude'),
    staleTime: CAPABILITIES_STALE_MS,
    enabled: provider !== null,
  });
  const picker = usePickerCommand({
    conversationId,
    capabilities: capabilities.data,
    agentName: providerLabel ?? 'This agent',
    notify: attachments.notify,
  });
  const canStartFresh = onStartFresh !== undefined;
  const hasSettings = settings !== null;
  const efforts = capabilities.data?.efforts;
  const agentConfig = useAgentConfig(repos[0]?.id ?? null);
  const skills = agentConfig.data?.settings.skills ? agentConfig.data.skills : NO_SKILLS;
  const pluginCommands = usePluginCommands(provider);
  const slashContext = useMemo(
    () => ({
      agentName,
      skills,
      pluginCommands,
      effortHint: effortHint(efforts ?? []),
      hidden: new Set<ClientCommandName>([
        ...(canStartFresh ? [] : (['fresh'] as const)),
        ...(hasSettings ? [] : (['model', 'effort'] as const)),
      ]),
    }),
    [agentName, skills, pluginCommands, efforts, canStartFresh, hasSettings],
  );
  const runCommand = (command: ClientCommandName, args = '') =>
    runClientCommand(
      {
        openMcp: () => setMcpOpen(true),
        onStartFresh,
        notify: attachments.notify,
        pick: picker.run,
        setDraft,
      },
      command,
      args,
    );
  const slash = useSlash({
    draft,
    setDraft,
    textareaRef,
    agentCommands,
    context: slashContext,
    onRun: (command) => void runCommand(command),
  });
  const closeRepo = useCallback(() => {
    setRepoOpen(false);
    textareaRef.current?.focus();
  }, []);
  const attachedPaths = useMemo(
    () =>
      new Set(
        attachments.items.flatMap((item) =>
          item.source.type === 'repo' && item.status !== 'error' ? [repoFileKey(item.source)] : [],
        ),
      ),
    [attachments.items],
  );
  useDraftRequests(conversationId, setDraft, textareaRef, quotes?.focusRequest ?? 0);

  const queueing = busy && onQueue !== undefined;
  const hasText = draft.trim().length > 0;
  const quoteItems = quotes?.items ?? [];
  useUnsentWork(conversationId, hasText || attachments.items.length > 0 || quoteItems.length > 0);
  const sendName = hasText ? 'Send' : sendLabel(quoteItems.map((quote) => quote.kind));
  const [delivering, setDelivering] = useState(false);
  const canQueue = queueing;
  const canSend =
    !voice.dictation.active &&
    ready &&
    (hasText || attachments.items.length > 0 || quoteItems.length > 0) &&
    !sending &&
    !delivering &&
    (!busy || canQueue) &&
    !attachments.uploading &&
    !attachments.failed;

  const outgoing = (): string | null => {
    const parsed = parseSlash(draft);
    const command = clientCommand(parsed);
    if (command && parsed) {
      setDraft('');
      return runCommand(command, parsed.args);
    }
    const skill = skillCommand(parsed, slash.all);
    if (skill) return skill;
    const blocked = blockedMessage(parsed);
    if (blocked) {
      attachments.notify(blocked);
      return null;
    }
    return draft;
  };

  const submit = async (choice: BusyEnterAction = busyEnter) => {
    lastChoice.current = choice;
    if (!canSend || secrets.blocks(draft)) return;
    const draftText = draft;
    const typed = outgoing();
    if (typed === null) return;
    const { content, annotations } = quotes?.compose(typed) ?? { content: typed, annotations: [] };
    const sentItems = [...attachments.items];
    const sentQuotes = [...quoteItems];
    setDraft('');
    if (queueing && onQueue) {
      const deliver = choice === 'now' && onSendNow ? onSendNow : onQueue;
      setDelivering(true);
      try {
        await deliver(content, attachments.uploaded, annotations);
        for (const item of sentItems) attachments.remove(item.key);
        for (const quote of sentQuotes) quotes?.remove(quote.id);
      } catch {
        setDraft((current) => restoreFailedDraft(current, draftText));
      } finally {
        setDelivering(false);
      }
      return;
    }
    try {
      await onSend(content, attachments.uploaded, annotations);
      attachments.clear();
      quotes?.clear();
    } catch {
      setDraft((current) => restoreFailedDraft(current, draftText));
    }
  };

  const sendAs = (choice: BusyEnterAction) => {
    void submit(choice);
    textareaRef.current?.focus();
  };

  const hint = ready
    ? composerHint(attachments, queueing, busyEnter, waitingOn, waitingBackground)
    : 'You can type while this chat opens';
  const typedNote = typedCommandNote(parseSlash(draft), slash.all, agentName);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slash.handleKey(event)) return;
    if (mention.handleKey(event)) return;
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      const inCode = codeBlockEnter(event, event.currentTarget);
      if (inCode === 'newline') return;
      event.preventDefault();
      void submit(inCode === 'send' ? busyEnter : enterAction(event, busyEnter));
    }
  };

  return (
    <ComposerShell
      error={error}
      warning={
        <SecretWarning
          guard={secrets}
          input={textareaRef}
          onText={setDraft}
          onSendAnyway={() => void submit(lastChoice.current)}
        />
      }
      above={above}
      foot={
        <>
          {ready && (
            <ContextBar
              conversationId={conversationId}
              repos={repos}
              popover={repoPopover}
              suggestion={
                <SparkSuggestion
                  conversationId={conversationId}
                  sparks={sparks}
                  draft={draft}
                  onApply={(text) => {
                    setDraft(text);
                    textareaRef.current?.focus();
                  }}
                />
              }
            />
          )}
          {sessionChip}
          <span className="comp-foot-end">
            <ContextRing
              conversationId={conversationId}
              runs={runs}
              provider={settings?.provider ?? null}
              usageTotals={usageTotals}
              {...(onAudit ? { onAudit } : {})}
            />
            <span ref={setModeSlot} className="comp-foot-mode" />
          </span>
        </>
      }
      bar={
        <>
          <PlusMenu
            hasProject={hasRepos}
            onAttach={attachments.add}
            onNotice={attachments.notify}
            onAddFromRepo={() => setRepoOpen(true)}
            onAddRepo={openRepoMenu}
            chatId={conversationId}
            onAddChat={attachments.addChat}
            formatting={formatting}
            onFormatting={() => {
              setFormatting((open) => !open);
              textareaRef.current?.focus();
            }}
          />
          <span
            className={!ready || attachments.items.length > 0 ? 'hint shown' : 'hint'}
            title={hint || undefined}
          >
            {hint}
          </span>
          {settings && (
            <ModelPicker
              openRequest={picker.request}
              conversationId={conversationId}
              settings={settings}
              providers={providers}
              runs={runs}
              hasRepos={hasRepos}
              chipSlot={modeSlot}
            />
          )}
          <MicButton dictation={voice.dictation} />
          <SendButton
            busy={busy}
            stopping={stopping}
            label={sendName}
            tip={SEND_KEYS_TIP}
            disabled={!canSend}
            onSend={() => void submit()}
            onStop={onStop}
            {...(queueing
              ? { busySend: { preferred: busyEnter, onChoice: sendAs, waiting: waitingOn > 0 } }
              : {})}
          />
        </>
      }
    >
      {quotes && <QuoteChips items={quotes.items} onRemove={quotes.remove} />}
      <AttachmentChips
        items={attachments.items}
        onRemove={attachments.remove}
        onRetry={attachments.retry}
        onAllowSlackChannel={attachments.allowSlackChannel}
      />
      <p className="composer-notice" role="status">
        {attachments.notice}
      </p>
      {notice && (
        <p className="composer-notice" role="status">
          {notice}
        </p>
      )}
      {typedNote && !slash.open && (
        <p className="composer-notice" role="status">
          {typedNote}
        </p>
      )}
      <label className="sr-only" htmlFor={inputId}>
        Message
      </label>
      {slash.open && (
        <SlashMenu
          listId={slash.listId}
          items={slash.items}
          active={slash.active}
          agentName={agentName}
          emptyNote={typedNote}
          onActive={slash.setActive}
          onPick={(item) => {
            slash.pick(item);
            textareaRef.current?.focus();
          }}
          onKeyDown={(event) => {
            if (slash.handleKey(event)) textareaRef.current?.focus();
          }}
        />
      )}
      {mcpOpen && (
        <ChatMcpPanel
          conversationId={conversationId}
          onClose={() => {
            setMcpOpen(false);
            textareaRef.current?.focus();
          }}
        />
      )}
      {mention.open && (
        <MentionPicker
          listId={mention.listId}
          left={mention.left}
          sparks={mention.sparks}
          active={mention.active}
          showsFiles={mention.showsFiles}
          search={mention.search}
          attached={attachedPaths}
          onActive={mention.setActive}
          onPick={mention.pick}
          onPickSpark={mention.pickSpark}
        />
      )}
      {repoOpen && hasRepos && (
        <RepoFilePicker
          repos={repos}
          attached={attachedPaths}
          onPick={addFromRepo}
          onClose={closeRepo}
        />
      )}
      <MarkdownInput
        ref={textareaRef}
        formatting={formatting}
        id={inputId}
        autoFocus={autoFocus}
        value={voice.value}
        rows={composerRows(voice.value)}
        placeholder={composerPlaceholder({
          queueing,
          preferred: busyEnter,
          hasRepos,
          hasSparks: sparks.length > 0,
        })}
        {...(slash.open ? slash.inputProps : mention.inputProps)}
        onChange={(event) => {
          voice.change(event.target.value);
          slash.sync(event.target);
          mention.sync(event.target);
        }}
        onSelect={(event) => {
          slash.sync(event.currentTarget);
          mention.sync(event.currentTarget);
        }}
        onBlur={(event) => {
          if (!focusMovesToSlashMenu(event.relatedTarget)) slash.dismiss();
          mention.dismiss();
        }}
        onKeyDown={onKeyDown}
        onPaste={(event) => pasteContext(event, attachments, conversationId)}
      />
    </ComposerShell>
  );
}
