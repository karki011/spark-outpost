import { memo, use, useId, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { plainOutput } from '@spark-outpost/contracts';
import { openCommandTab } from '../../terminal/dock/shell-store.ts';
import { CheckIcon, ChevronIcon, CopyIcon, TerminalIcon } from '../../ui/icons.tsx';
import { QueryWait } from '../../ui/loading/QueryWait.tsx';
import { Skeleton } from '../../ui/loading/Skeleton.tsx';
import { useCopyFeedback } from '../../ui/use-copy-feedback.ts';
import { commandOutputKey, fetchCommandOutput } from './command-api.ts';
import { CommandDockContext } from './command-dock.ts';
import { commandOutcome, type CommandView } from './command-model.ts';
import { CommandScreen } from './CommandScreen.tsx';
import { CommandWord } from './CommandStatus.tsx';
import { RowIcon } from '../rows/RowIcon.tsx';
import './command-terminal.css';

const KB = 1024;

function sizeNote(command: CommandView, shown: number): string | null {
  if (command.status === 'running' || command.outputChars <= shown + KB) return null;
  const kb = (chars: number) => `${Math.max(1, Math.round(chars / KB)).toLocaleString('en-US')} KB`;
  return `Showing the last ${kb(shown)} of ${kb(command.outputChars)}.`;
}

function useOpenState(command: CommandView) {
  const [choice, setChoice] = useState<boolean | null>(null);
  const open = choice ?? (command.status === 'failed' || command.status === 'interrupted');
  return {
    open,
    touch: () => {
      setChoice((current) => current ?? open);
    },
    toggle: () => setChoice(!open),
  };
}

interface CommandTerminalProps {
  command: CommandView;
  waiting?: boolean;
}

function sameTerminal(before: CommandTerminalProps, after: CommandTerminalProps): boolean {
  const [was, now] = [before.command, after.command];
  return (
    before.waiting === after.waiting &&
    was.id === now.id &&
    was.runId === now.runId &&
    was.status === now.status &&
    was.output === now.output &&
    was.appended === now.appended &&
    was.epoch === now.epoch &&
    was.exitCode === now.exitCode &&
    was.finishedAt === now.finishedAt &&
    was.outputChars === now.outputChars
  );
}

export const CommandTerminal = memo(function CommandTerminal({
  command,
  waiting = false,
}: CommandTerminalProps) {
  const bodyId = useId();
  const dockChatId = use(CommandDockContext);
  const { open, touch, toggle } = useOpenState(command);
  const [tall, setTall] = useState(false);
  const { state: copyState, copy } = useCopyFeedback();
  const queryClient = useQueryClient();
  const running = command.status === 'running';
  const saved = {
    queryKey: commandOutputKey(command.runId, command.id, running),
    queryFn: () => fetchCommandOutput(command.runId, command.id),
    staleTime: running ? 0 : Infinity,
  };
  const loaded = useQuery({ ...saved, enabled: open && command.output === null });
  const text = command.output ?? loaded.data?.output ?? null;
  const copied = copyState === 'copied';
  const copyOutput = () => {
    touch();
    if (text !== null) copy(plainOutput(text));
    else void queryClient.fetchQuery(saved).then((result) => copy(plainOutput(result.output)));
  };
  const awaitsEnd = running && !command.live && !text;
  const note = sizeNote(command, text?.length ?? 0);

  return (
    <section
      className={`run-cmd ${command.status}${open ? ' open' : ''}`}
      aria-label={`Command: ${command.command}`}
      data-command={command.id}
    >
      <div className="run-cmd-head">
        <button
          type="button"
          className="run-cmd-toggle trow"
          aria-expanded={open}
          aria-controls={bodyId}
          title={command.cwd ? `${command.command}\n${command.cwd}` : command.command}
          onClick={toggle}
        >
          <RowIcon name="run" />
          <span className="trow-text">
            <b>{running ? 'Running' : 'Ran'}</b>
            <code className={tall && open ? 'run-cmd-line full' : 'run-cmd-line'}>
              {command.command}
            </code>
          </span>
          <span className="trow-end run-cmd-state">
            <CommandWord command={command} waiting={waiting} />
            <ChevronIcon />
          </span>
        </button>
      </div>
      <span className="sr-only" role="status">
        {running ? `Running ${command.command.slice(0, 120)}` : commandOutcome(command)}
      </span>
      <div className="run-cmd-body" id={bodyId} hidden={!open}>
        {open && (
          <div className="run-cmd-tools">
            {!awaitsEnd && (
              <button
                type="button"
                className="icon-btn run-cmd-size"
                aria-pressed={tall}
                aria-label="Taller output"
                title={tall ? 'Shorter' : 'Taller'}
                onClick={() => {
                  touch();
                  setTall(!tall);
                }}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                  <path
                    d={
                      tall
                        ? 'M3.5 5 7 1.8 10.5 5M3.5 9 7 12.2 10.5 9'
                        : 'M3.5 4 7 7.2 10.5 4M3.5 8 7 11.2 10.5 8'
                    }
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.4"
                  />
                </svg>
              </button>
            )}
            {dockChatId && (
              <button
                type="button"
                className="icon-btn run-cmd-dock"
                aria-label="Open in terminal"
                title="Open in terminal"
                onClick={() => {
                  touch();
                  openCommandTab(dockChatId, command.runId, command.id);
                }}
              >
                <TerminalIcon />
              </button>
            )}
            <button
              type="button"
              className="icon-btn run-cmd-copy"
              aria-label={copied ? 'Copied' : 'Copy output'}
              title={copied ? 'Copied' : 'Copy output'}
              disabled={awaitsEnd}
              onClick={copyOutput}
            >
              {copied ? <CheckIcon className="run-cmd-ok" /> : <CopyIcon />}
            </button>
          </div>
        )}
        {open && awaitsEnd && <p className="run-cmd-note">Output shows when the command ends.</p>}
        {open && !awaitsEnd && text === null && (
          <div className="run-cmd-wait-load">
            <QueryWait query={loaded} what="the command output">
              <Skeleton label="Loading the command output" rows={3} />
            </QueryWait>
          </div>
        )}
        {open && !awaitsEnd && text === '' && command.status !== 'interrupted' && !running && (
          <p className="run-cmd-note">No output.</p>
        )}
        {open && !awaitsEnd && text !== null && (text !== '' || running) && (
          <CommandScreen
            text={text}
            appended={command.output === null ? text.length : command.appended}
            epoch={command.epoch}
            tall={tall}
            fit={!running}
            onTouched={touch}
          />
        )}
        {open && command.status === 'interrupted' && (
          <p className="run-cmd-note">
            {text
              ? 'Interrupted before it finished. This is what was captured.'
              : 'Interrupted before it finished. No output was captured.'}
          </p>
        )}
        {open && note && <p className="run-cmd-note">{note}</p>}
      </div>
    </section>
  );
}, sameTerminal);
