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
  type Run,
} from '@spark-outpost/contracts';
import { useQuery } from '@tanstack/react-query';
import { CAPABILITIES_STALE_MS, capabilitiesQuery } from '../api/client.ts';
import { usePopover } from '../ui/use-popover.ts';
import { AttachmentChips } from './attachments/AttachmentChips.tsx';
import type { AttachmentsState } from './attachments/use-attachments.ts';
import { ContextRing } from './composer/ContextRing.tsx';
import { ModelPicker, type PickerRequest } from './composer/ModelPicker.tsx';
import {
  blockedMessage,
  clientCommand,
  effortHint,
  typedCommandNote,
  parseSlash,
  planPrompt,
  reviewPrompt,
  type ClientCommandName,
} from './composer/slash.ts';
import { SlashMenu } from './composer/SlashMenu.tsx';
import { ChatMcpPanel } from './composer/ChatMcpPanel.tsx';
import { useSlash } from './composer/use-slash.ts';
import { takeDraft, usePendingDraft } from './composer/pending-draft.ts';
import { PlusMenu } from './composer/PlusMenu.tsx';
import { ContextBar } from './project/ContextBar.tsx';
import { MentionPicker } from './project/MentionPicker.tsx';
import { RepoFilePicker } from './project/RepoFilePicker.tsx';
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
  onAudit?: () => void;
  onStartFresh?: () => void;
  agentCommands?: readonly AgentCommand[];
  agentName?: string;
  autoFocus?: boolean;
}

const NO_COMMANDS: readonly AgentCommand[] = [];

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
  sending,
  error,
  attachments,
  onSend,
  onStop,
  onAudit,
  onStartFresh,
  agentCommands = NO_COMMANDS,
  agentName = 'Agent',
  autoFocus = true,
  quotes,
}: ComposerProps) {
  const [draft, setDraft] = useState('');
  const [repoOpen, setRepoOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
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
  const [pickerRequest, setPickerRequest] = useState<PickerRequest | null>(null);
  const [mcpOpen, setMcpOpen] = useState(false);
  const provider = settings?.provider ?? null;
  const capabilities = useQuery({
    ...capabilitiesQuery(provider ?? 'claude'),
    staleTime: CAPABILITIES_STALE_MS,
    enabled: provider !== null,
  });
  const canStartFresh = onStartFresh !== undefined;
  const hasSettings = settings !== null;
  const efforts = capabilities.data?.efforts;
  const slashContext = useMemo(
    () => ({
      agentName,
      effortHint: effortHint(efforts ?? []),
      hidden: new Set<ClientCommandName>([
        ...(canStartFresh ? [] : (['fresh'] as const)),
        ...(hasSettings ? [] : (['model', 'effort'] as const)),
      ]),
    }),
    [agentName, efforts, canStartFresh, hasSettings],
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
      setPickerRequest({
        section: command,
        id: (pickerRequest?.id ?? 0) + 1,
        ...(args ? { value: args } : {}),
      });
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

  const hasText = draft.trim().length > 0;
  const quoteItems = quotes?.items ?? [];
  const sendName = hasText ? 'Send' : sendLabel(quoteItems.map((quote) => quote.kind));
  const canSend =
    (hasText || attachments.items.length > 0 || quoteItems.length > 0) &&
    !sending &&
    !busy &&
    !attachments.uploading &&
    !attachments.failed;

  const outgoing = (): string | null => {
    const parsed = parseSlash(draft);
    const command = clientCommand(parsed);
    if (command && parsed) {
      setDraft('');
      return runClientCommand(command, parsed.args);
    }
    const blocked = blockedMessage(parsed);
    if (blocked) {
      attachments.notify(blocked);
      return null;
    }
    return draft;
  };

  const submit = async () => {
    if (!canSend) return;
    const draftText = draft;
    const typed = outgoing();
    if (typed === null) return;
    const { content, annotations } = quotes?.compose(typed) ?? { content: typed, annotations: [] };
    if (content.length > MESSAGE_MAX_LENGTH) {
      attachments.notify('Your quotes and message are too long to send. Remove a quote first.');
      return;
    }
    setDraft('');
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
      <ContextBar conversationId={conversationId} repos={repos} popover={repoPopover} />
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
            hasRepos
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
            {composerHint(attachments)}
          </span>
          {settings && (
            <ModelPicker
              openRequest={pickerRequest}
              onNotice={attachments.notify}
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
          {busy ? (
            <button type="button" className="send busy" aria-label="Stop" onClick={onStop}>
              <svg className="stop-ring" viewBox="0 0 32 32" aria-hidden="true">
                <circle cx="16" cy="16" r="14" />
              </svg>
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <rect x="0.5" y="0.5" width="9" height="9" rx="2" fill="currentColor" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              className="send"
              aria-label={sendName}
              title={sendName === 'Send' ? undefined : sendName}
              disabled={!canSend}
              onClick={() => void submit()}
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
          )}
        </div>
      </div>
    </div>
  );
}

function composerHint(attachments: AttachmentsState): string {
  if (attachments.uploading) return 'Uploading your files…';
  if (attachments.failed) return 'Remove or retry the files that failed';
  return 'Enter to send, Shift + Enter for a new line';
}
