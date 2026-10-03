import './composer.css';
import './composer/composer-popovers.css';
import './project/project.css';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from 'react';
import {
  MESSAGE_MAX_LENGTH,
  type AgentCommand,
  type AnnotationInput,
  type Attachment,
  type ChatSettings,
  type ConversationUsage,
  type Orchestration,
  type Project,
  type ProviderSetup,
  type RepoDefinition,
  type Run,
} from '@spark-outpost/contracts';
import { useQuery } from '@tanstack/react-query';
import { CAPABILITIES_STALE_MS, capabilitiesQuery } from '../api/client.ts';
import { usePopover } from '../ui/use-popover.ts';
import { AttachmentChips } from './attachments/AttachmentChips.tsx';
import type { AttachmentsState } from './attachments/use-attachments.ts';
import { ContextRing } from './composer/ContextRing.tsx';
import { ModelPicker } from './composer/ModelPicker.tsx';
import { SparkOffChip } from '../spark/SparkOffChip.tsx';
import { SecretWarning } from '../ui/SecretWarning.tsx';
import { useSecretGuard } from '../ui/use-secret-guard.ts';
import { SteerTarget } from '../crew/SteerTarget.tsx';
import type { SteerControl } from '../crew/use-steer.ts';
import {
  blockedMessage,
  clientCommand,
  effortHint,
  typedCommandNote,
  parseSlash,
  planPrompt,
  reviewPrompt,
  skillCommand,
  type ClientCommandName,
} from './composer/slash.ts';
import { SlashMenu } from './composer/SlashMenu.tsx';
import { ChatMcpPanel } from './composer/ChatMcpPanel.tsx';
import { usePickerCommand } from './composer/use-picker-command.ts';
import { useSlash } from './composer/use-slash.ts';
import { takeDraft, usePendingDraft } from './composer/pending-draft.ts';
import { PlusMenu } from './composer/PlusMenu.tsx';
import { SendButton } from './composer/SendButton.tsx';
import { composerHint } from './composer/composer-hint.ts';
import type { AutonomyControl } from './project/AutonomyChip.tsx';
import { ContextBar } from './project/ContextBar.tsx';
import { MentionPicker } from './project/MentionPicker.tsx';
import { RepoFilePicker } from './project/RepoFilePicker.tsx';
import { useAgentConfig } from './project/use-agent-config.ts';
import { repoFileKey, type RepoFile } from './project/use-file-search.ts';
import { useMention } from './project/use-mention.ts';
import { QuoteChips } from './quotes/QuoteChips.tsx';
import { sendLabel } from './quotes/quote-text.ts';
import type { QuotesState } from './quotes/use-quotes.ts';

interface ComposerProps {
  conversationId: string;
  repos: Project[];
  settings: ChatSettings | null;
  providers: ProviderSetup[];
  runs: Run[];
  orchestration?: Orchestration | null;
  usageTotals: ConversationUsage;
  busy: boolean;
  stopping?: boolean;
  sending: boolean;
  error: string | null;
  attachments: AttachmentsState;
  onSend: (
    content: string,
    attachments: Attachment[],
    annotations: AnnotationInput[],
  ) => Promise<void>;
  quotes?: QuotesState;
  onStop: () => void;
  onQueue?: (content: string) => Promise<void>;
  steer?: SteerControl | null;
  onAudit?: () => void;
  onStartFresh?: () => void;
  autonomy?: AutonomyControl | null;
  agentCommands?: readonly AgentCommand[];
  agentName?: string;
  autoFocus?: boolean;
}

const NO_COMMANDS: readonly AgentCommand[] = [];
const NO_SKILLS: readonly RepoDefinition[] = [];

const MAX_ROWS = 5;

function focusAtEnd(input: HTMLTextAreaElement) {
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

function focusMovesToSlashMenu(next: EventTarget | null): boolean {
  return next instanceof Element && next.closest('.slashpop') !== null;
}

export function Composer({
  conversationId,
  repos,
  settings,
  providers,
  runs,
  orchestration = null,
  usageTotals,
  busy,
  stopping = false,
  sending,
  error,
  attachments,
  onSend,
  onStop,
  onQueue,
  steer = null,
  onAudit,
  onStartFresh,
  autonomy = null,
  agentCommands = NO_COMMANDS,
  agentName = 'Agent',
  autoFocus = true,
  quotes,
}: ComposerProps) {
  const [draft, setDraft] = useState('');
  const [repoOpen, setRepoOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const secrets = useSecretGuard(draft);
  const inputId = useId();
  const pendingDraft = usePendingDraft(conversationId);
  const repoPopover = usePopover<HTMLButtonElement, HTMLDivElement>();
  const hasRepos = repos.length > 0;
  const addFromRepo = (file: RepoFile) => attachments.addFromRepo(file.projectId, file);
  const openRepoMenu = () => {
    repoPopover.setOpen(true);
    repoPopover.anchorRef.current?.focus();
  };
  const mention = useMention({
    repos,
    draft,
    setDraft,
    textareaRef,
    onPick: addFromRepo,
  });
  const [mcpOpen, setMcpOpen] = useState(false);
  const provider = settings?.provider ?? null;
  const capabilities = useQuery({
    ...capabilitiesQuery(provider ?? 'claude'),
    staleTime: CAPABILITIES_STALE_MS,
    enabled: provider !== null,
  });
  const picker = usePickerCommand({
    conversationId,
    capabilities: capabilities.data,
    agentName: providers.find((entry) => entry.id === provider)?.name ?? 'This agent',
    notify: attachments.notify,
  });
  const canStartFresh = onStartFresh !== undefined;
  const hasSettings = settings !== null;
  const efforts = capabilities.data?.efforts;
  const agentConfig = useAgentConfig(repos[0]?.id ?? null);
  const skills = agentConfig.data?.settings.skills ? agentConfig.data.skills : NO_SKILLS;
  const slashContext = useMemo(
    () => ({
      agentName,
      skills,
      effortHint: effortHint(efforts ?? []),
      hidden: new Set<ClientCommandName>([
        ...(canStartFresh ? [] : (['fresh'] as const)),
        ...(hasSettings ? [] : (['model', 'effort'] as const)),
      ]),
    }),
    [agentName, skills, efforts, canStartFresh, hasSettings],
  );
  const runClientCommand = (command: ClientCommandName, args = ''): string | null => {
    if (command === 'mcp') {
      setMcpOpen(true);
      return null;
    }
    if (command === 'fresh') {
      onStartFresh?.();
      attachments.notify(
        onStartFresh
          ? 'Started fresh. Your next message opens a new agent session.'
          : 'This chat has no agent session yet.',
      );
      return null;
    }
    if (command === 'model' || command === 'effort') {
      picker.run(command, args);
      return null;
    }
    if (command === 'plan') {
      if (args) return planPrompt(args);
      attachments.notify('Add what to plan after /plan.');
      setDraft('/plan ');
      return null;
    }
    return reviewPrompt(args);
  };
  const slash = useSlash({
    draft,
    setDraft,
    textareaRef,
    agentCommands,
    context: slashContext,
    onRun: (command) => void runClientCommand(command),
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
  const [appliedDraft, setAppliedDraft] = useState<string | null>(null);
  if (pendingDraft !== appliedDraft) {
    setAppliedDraft(pendingDraft);
    if (pendingDraft !== null) setDraft(pendingDraft);
  }

  useEffect(() => {
    if (pendingDraft === null) return;
    takeDraft(conversationId);
    requestAnimationFrame(() => {
      const input = textareaRef.current;
      if (input) focusAtEnd(input);
    });
  }, [pendingDraft, conversationId]);

  const focusRequest = quotes?.focusRequest ?? 0;
  useEffect(() => {
    if (focusRequest === 0) return;
    const input = textareaRef.current;
    if (input) focusAtEnd(input);
  }, [focusRequest]);

  const steering = busy ? steer : null;
  const queueing = busy && steering === null && onQueue !== undefined;
  const hasText = draft.trim().length > 0;
  const quoteItems = quotes?.items ?? [];
  const sendName = hasText ? 'Send' : sendLabel(quoteItems.map((quote) => quote.kind));
  const canQueue = queueing && hasText && attachments.items.length === 0;
  const canSend =
    (hasText || attachments.items.length > 0 || quoteItems.length > 0) &&
    !sending &&
    (!busy || (steering !== null && hasText) || canQueue) &&
    !attachments.uploading &&
    !attachments.failed;

  const outgoing = (): string | null => {
    const parsed = parseSlash(draft);
    const command = clientCommand(parsed);
    if (command && parsed) {
      setDraft('');
      return runClientCommand(command, parsed.args);
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

  const submit = async () => {
    if (!canSend || secrets.blocks(draft)) return;
    const draftText = draft;
    if (steering) {
      setDraft('');
      await steering.send(draftText).catch(() => setDraft(draftText));
      return;
    }
    const typed = outgoing();
    if (typed === null) return;
    const { content, annotations } = quotes?.compose(typed) ?? { content: typed, annotations: [] };
    if (content.length > MESSAGE_MAX_LENGTH) {
      attachments.notify('Your quotes and message are too long to send. Remove a quote first.');
      return;
    }
    setDraft('');
    if (queueing && onQueue) {
      await onQueue(content).then(
        () => quotes?.clear(),
        () => setDraft(draftText),
      );
      return;
    }
    try {
      await onSend(content, attachments.uploaded, annotations);
      attachments.clear();
      quotes?.clear();
    } catch {
      setDraft(draftText);
    }
  };

  const typedNote = typedCommandNote(parseSlash(draft), slash.all, agentName);

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files);
    if (files.length === 0) return;
    event.preventDefault();
    attachments.add(files);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slash.handleKey(event)) return;
    if (mention.handleKey(event)) return;
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <div className="composer-wrap">
      {error && (
        <p className="composer-error" role="alert">
          {error}
        </p>
      )}
      <SecretWarning
        guard={secrets}
        input={textareaRef}
        onText={setDraft}
        onSendAnyway={() => void submit()}
      />
      <ContextBar
        conversationId={conversationId}
        repos={repos}
        popover={repoPopover}
        autonomy={autonomy}
      />
      <div className="composer">
        {quotes && <QuoteChips items={quotes.items} onRemove={quotes.remove} />}
        <AttachmentChips
          items={attachments.items}
          onRemove={attachments.remove}
          onRetry={attachments.retry}
        />
        <p className="composer-notice" role="status">
          {attachments.notice}
        </p>
        {steering?.status && (
          <p className="composer-notice" role="status">
            {steering.status}
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
            search={mention.search}
            attached={attachedPaths}
            onPick={mention.pick}
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
        <textarea
          ref={textareaRef}
          id={inputId}
          autoFocus={autoFocus}
          value={draft}
          rows={Math.min(MAX_ROWS, Math.max(1, draft.split('\n').length))}
          maxLength={MESSAGE_MAX_LENGTH}
          placeholder={
            steering
              ? 'Steer the pieces while they run'
              : queueing
                ? 'Queue a message for when this turn ends'
                : hasRepos
                  ? 'Ask anything, @ to add a file, / for commands'
                  : 'Ask anything, / for commands'
          }
          {...(slash.open ? slash.inputProps : mention.inputProps)}
          onChange={(event) => {
            setDraft(event.target.value);
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
          onPaste={onPaste}
        />
        <div className="comp-bar">
          <PlusMenu
            hasProject={hasRepos}
            onAttach={attachments.add}
            onNotice={attachments.notify}
            onAddFromRepo={() => setRepoOpen(true)}
            onAddRepo={openRepoMenu}
          />
          <span className={attachments.items.length > 0 ? 'hint shown' : 'hint'}>
            {composerHint(attachments, queueing)}
          </span>
          <SparkOffChip />
          {settings && (
            <ModelPicker
              openRequest={picker.request}
              conversationId={conversationId}
              settings={settings}
              providers={providers}
              hasRepos={hasRepos}
              orchestration={orchestration}
            />
          )}
          <ContextRing
            runs={runs}
            provider={settings?.provider ?? null}
            usageTotals={usageTotals}
            orchestration={orchestration}
            {...(onAudit ? { onAudit } : {})}
          />
          {steering && (
            <SteerTarget control={steering} ready={canSend} onSend={() => void submit()} />
          )}
          <SendButton
            busy={busy}
            stopping={stopping}
            label={sendName}
            disabled={!canSend}
            onSend={() => void submit()}
            onStop={onStop}
            {...(queueing ? { onQueue: () => void submit() } : {})}
          />
        </div>
      </div>
    </div>
  );
}
