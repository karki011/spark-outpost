import './composer.css';
import './composer/composer-popovers.css';
import './project/project.css';
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from 'react';
import {
  MESSAGE_MAX_LENGTH,
  type Attachment,
  type ChatSettings,
  type ConversationUsage,
  type Orchestration,
  type Project,
  type ProviderSetup,
  type Run,
} from '@spark-outpost/contracts';
import { usePopover } from '../ui/use-popover.ts';
import { AttachmentChips } from './attachments/AttachmentChips.tsx';
import type { AttachmentsState } from './attachments/use-attachments.ts';
import { ContextRing } from './composer/ContextRing.tsx';
import { ModelPicker } from './composer/ModelPicker.tsx';
import { PlusMenu } from './composer/PlusMenu.tsx';
import { ContextBar } from './project/ContextBar.tsx';
import { MentionPicker } from './project/MentionPicker.tsx';
import { RepoFilePicker } from './project/RepoFilePicker.tsx';
import { repoFileKey, type RepoFile } from './project/use-file-search.ts';
import { useMention } from './project/use-mention.ts';

interface ComposerProps {
  conversationId: string;
  repos: Project[];
  settings: ChatSettings | null;
  providers: ProviderSetup[];
  runs: Run[];
  orchestration?: Orchestration | null;
  jevConnected?: boolean;
  usageTotals: ConversationUsage;
  busy: boolean;
  sending: boolean;
  error: string | null;
  attachments: AttachmentsState;
  onSend: (content: string, attachments: Attachment[]) => Promise<void>;
  onStop: () => void;
  onAudit?: () => void;
}

const MAX_ROWS = 5;

export function Composer({
  conversationId,
  repos,
  settings,
  providers,
  runs,
  orchestration = null,
  jevConnected = false,
  usageTotals,
  busy,
  sending,
  error,
  attachments,
  onSend,
  onStop,
  onAudit,
}: ComposerProps) {
  const [draft, setDraft] = useState('');
  const [repoOpen, setRepoOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
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
  const hasText = draft.trim().length > 0;
  const canSend =
    (hasText || attachments.items.length > 0) &&
    !sending &&
    !busy &&
    !attachments.uploading &&
    !attachments.failed;

  const submit = async () => {
    if (!canSend) return;
    const content = draft;
    setDraft('');
    try {
      await onSend(content, attachments.uploaded);
      attachments.clear();
    } catch {
      setDraft(content);
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files);
    if (files.length === 0) return;
    event.preventDefault();
    attachments.add(files);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
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
        <AttachmentChips
          items={attachments.items}
          onRemove={attachments.remove}
          onRetry={attachments.retry}
        />
        <p className="composer-notice" role="status">
          {attachments.notice}
        </p>
        <label className="sr-only" htmlFor="composer-input">
          Message
        </label>
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
          id="composer-input"
          autoFocus
          value={draft}
          rows={Math.min(MAX_ROWS, Math.max(1, draft.split('\n').length))}
          maxLength={MESSAGE_MAX_LENGTH}
          placeholder={hasRepos ? 'Ask anything, @ to add a file' : 'Ask anything'}
          {...mention.inputProps}
          onChange={(event) => {
            setDraft(event.target.value);
            mention.sync(event.target);
          }}
          onSelect={(event) => mention.sync(event.currentTarget)}
          onBlur={() => mention.dismiss()}
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
              conversationId={conversationId}
              settings={settings}
              providers={providers}
              hasRepos={hasRepos}
              jevConnected={jevConnected}
              orchestration={orchestration}
            />
          )}
          <ContextRing
            runs={runs}
            provider={settings?.provider ?? null}
            usageTotals={usageTotals}
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
              aria-label="Send"
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
