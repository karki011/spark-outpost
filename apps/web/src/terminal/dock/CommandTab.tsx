import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, queryKeys } from '../../api/client.ts';
import { commandOutputKey, fetchCommandOutput } from '../../chat/commands/command-api.ts';
import type { CommandView } from '../../chat/commands/command-model.ts';
import { CommandScreen } from '../../chat/commands/CommandScreen.tsx';
import { Elapsed, stateText, StatusMark } from '../../chat/commands/CommandStatus.tsx';
import '../../chat/commands/command-terminal.css';
import { useLinkedProjects } from '../../chat/project/use-chat-repos.ts';
import { useChatWorkspace } from '../../chat/project/use-chat-workspace.ts';
import { providerName } from '../../chat/provider-name.ts';
import { activeRuns } from '../../chat/turns.ts';
import { useRunStream } from '../../chat/use-run-stream.ts';
import { useStop } from '../../chat/use-stop.ts';
import { QueryWait } from '../../ui/loading/QueryWait.tsx';
import { Skeleton } from '../../ui/loading/Skeleton.tsx';
import {
  AGENT_TAB_WORDS,
  commandTabLabel,
  isSettled,
  MIRROR_AWAITS_END,
  MIRROR_MISSING,
  MIRROR_OWNER_NOTE,
  mirrorBody,
  mirroredCommand,
  mirrorEnding,
  mirrorFolder,
  mirrorStatus,
  needsSavedOutput,
  type MirroredCommand,
} from './command-tabs.ts';
import { syncCommandTab, type ShellTab } from './shell-store.ts';
import { invalidateChatDetail } from '../../api/chat-detail.ts';

const untouched = () => undefined;
const NO_PROJECTS: readonly string[] = [];

function MirrorHead({ command }: { command: CommandView }) {
  return (
    <div className="cmd-tab-head">
      <StatusMark command={command} waiting={false} />
      <code className="cmd-tab-line" title={command.command}>
        {command.command}
      </code>
      <span className="cmd-tab-chip">Run by the agent · read-only</span>
      <span className="cmd-tab-state">
        {command.status === 'running' ? <Elapsed command={command} /> : stateText(command)}
      </span>
    </div>
  );
}

function Mirror({
  chatId,
  tabId,
  mirror,
}: {
  chatId: string;
  tabId: string;
  mirror: MirroredCommand;
}) {
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: queryKeys.conversation(chatId),
    queryFn: () => api.getConversation(chatId),
  });
  const settled = isSettled(detail.data?.commands, mirror);
  const stream = useRunStream(mirror.runId, chatId, detail.isSuccess && !settled);
  const command = mirroredCommand(detail.data?.commands, stream.commands, mirror);
  const catchingUp = stream.status === 'connecting' || stream.status === 'running';
  const searching = !detail.isSuccess || (!settled && catchingUp);
  const running = command?.status === 'running';
  const loaded = useQuery({
    queryKey: commandOutputKey(mirror.runId, mirror.commandId, running),
    queryFn: () => fetchCommandOutput(mirror.runId, mirror.commandId),
    staleTime: running ? 0 : Infinity,
    enabled: needsSavedOutput(command),
  });
  const text = command ? (command.output ?? loaded.data?.output ?? null) : null;
  const stop = useStop(chatId, detail.data, () => invalidateChatDetail(queryClient, chatId));

  const provider = detail.data?.runs.find((run) => run.id === mirror.runId)?.provider ?? null;
  const label = command
    ? commandTabLabel(provider && providerName(provider), command.command)
    : null;
  const status = mirrorStatus(command, searching);
  const workspace = useChatWorkspace(chatId);
  const linked = useLinkedProjects(detail.data?.conversation.projectIds ?? NO_PROJECTS);
  const workFolder = workspace.data?.current?.path ?? linked[0]?.rootPath ?? null;
  const cwd = mirrorFolder(command?.cwd ?? null, workFolder);
  useEffect(() => {
    syncCommandTab(chatId, tabId, { label: label ?? (searching ? null : 'Command'), cwd, status });
  }, [chatId, tabId, label, cwd, status, searching]);

  const body = mirrorBody(command, text, searching);
  const canStop = running && activeRuns(detail.data).length > 0;

  return (
    <div
      className={`cmd-tab ${command?.status ?? 'finding'}`}
      role="group"
      aria-label={`${label ?? 'Command'}, ${AGENT_TAB_WORDS}, read-only`}
      tabIndex={-1}
      data-mirror-focus=""
    >
      {command && <MirrorHead command={command} />}
      <div className="cmd-tab-body">
        {body === 'finding' && <Skeleton label="Loading the command" rows={3} />}
        {body === 'missing' && <p className="cmd-tab-note">{MIRROR_MISSING}</p>}
        {body === 'awaits-end' && <p className="cmd-tab-note">{MIRROR_AWAITS_END}</p>}
        {body === 'loading' && (
          <QueryWait query={loaded} what="the command output">
            <Skeleton label="Loading the command output" rows={3} />
          </QueryWait>
        )}
        {body === 'empty' && <p className="cmd-tab-note">No output.</p>}
        {body === 'screen' && command && text !== null && (
          <CommandScreen
            text={text}
            appended={command.output === null ? text.length : command.appended}
            epoch={command.epoch}
            tall={false}
            fill
            onTouched={untouched}
          />
        )}
      </div>
      {command && (
        <div className="cmd-tab-foot">
          <p role="status">
            {running ? MIRROR_OWNER_NOTE : mirrorEnding(command, text)}
            {stop.error && <span className="cmd-tab-error"> {stop.error}</span>}
          </p>
          {canStop && (
            <button type="button" className="btn sm" disabled={stop.stopping} onClick={stop.stop}>
              {stop.stopping ? 'Stopping…' : 'Stop turn'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function CommandTab({ chatId, tab }: { chatId: string; tab: ShellTab }) {
  if (!tab.mirror) return null;
  return createPortal(<Mirror chatId={chatId} tabId={tab.id} mirror={tab.mirror} />, tab.host);
}
