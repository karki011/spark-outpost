import { memo, useEffect, useId, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { plainOutput } from '@spark-outpost/contracts';
import { CheckIcon, ChevronIcon, CopyIcon, XIcon } from '../../ui/icons.tsx';
import { QueryWait } from '../../ui/loading/QueryWait.tsx';
import { Skeleton } from '../../ui/loading/Skeleton.tsx';
import { useCopyFeedback } from '../../ui/use-copy-feedback.ts';
import { commandOutputKey, fetchCommandOutput } from './command-api.ts';
import {
  commandOutcome,
  commandSeconds,
  shownDuration,
  type CommandView,
} from './command-model.ts';
import { CommandScreen } from './CommandScreen.tsx';
import './command-terminal.css';

const COLLAPSE_AFTER_MS = 1500;
const KB = 1024;

function Elapsed({ command }: { command: CommandView }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <>{shownDuration(commandSeconds(command, now))}</>;
}

function StatusMark({ command, waiting }: { command: CommandView; waiting: boolean }) {
  if (command.status === 'running') {
    return <span className={waiting ? 'run-cmd-wait' : 'spin'} aria-hidden="true" />;
  }
  return (
    <span className="run-cmd-mark" aria-hidden="true">
      {command.status === 'completed' ? <CheckIcon className="run-cmd-ok" /> : <XIcon />}
    </span>
  );
}

function stateText(command: CommandView): string {
  if (command.status === 'interrupted') return 'interrupted';
  const took = shownDuration(commandSeconds(command, Date.now()));
  if (command.exitCode !== null) return `exit ${command.exitCode} · ${took}`;
  return `${command.status === 'failed' ? 'failed' : 'done'} · ${took}`;
}

function sizeNote(command: CommandView, shown: number): string | null {
  if (command.status === 'running' || command.outputChars <= shown + KB) return null;
  const kb = (chars: number) => `${Math.max(1, Math.round(chars / KB)).toLocaleString('en-US')} KB`;
  return `Showing the last ${kb(shown)} of ${kb(command.outputChars)}.`;
}

function useOpenState(command: CommandView, waiting: boolean) {
  const [wasRunning] = useState(command.status === 'running');
  const [settled, setSettled] = useState(false);
  const [choice, setChoice] = useState<boolean | null>(null);
  const touched = useRef(false);
  const lingers = command.status === 'completed' && wasRunning && command.live && !settled;

  useEffect(() => {
    if (!lingers) return;
    const timer = setTimeout(() => {
      if (!touched.current) setSettled(true);
    }, COLLAPSE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [lingers]);

  const held = waiting && command.status === 'running';
  const open = choice ?? (command.status === 'completed' ? lingers : !held);
  return {
    open,
    touch: () => {
      touched.current = true;
    },
    toggle: () => {
      touched.current = true;
      setChoice(!open);
    },
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
  const { open, touch, toggle } = useOpenState(command, waiting);
  const [tall, setTall] = useState(false);
  const { state: copyState, copy } = useCopyFeedback();
  const queryClient = useQueryClient();
  const running = command.status === 'running';
  const saved = {
    queryKey: commandOutputKey(command.runId, command.id),
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
          className="run-cmd-toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          title={command.command}
          onClick={toggle}
        >
          <ChevronIcon />
          <StatusMark command={command} waiting={waiting} />
          <code className={tall && open ? 'run-cmd-line full' : 'run-cmd-line'}>
            {command.command}
          </code>
          {command.cwd && <span className="run-cmd-cwd">{command.cwd}</span>}
          <span className="run-cmd-state">
            {running ? (
              waiting ? (
                'waiting for you'
              ) : (
                <Elapsed command={command} />
              )
            ) : (
              stateText(command)
            )}
          </span>
        </button>
        {open && !awaitsEnd && (
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
      <span className="sr-only" role="status">
        {running ? `Running ${command.command.slice(0, 120)}` : commandOutcome(command)}
      </span>
      <div className="run-cmd-body" id={bodyId} hidden={!open}>
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
