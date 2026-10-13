import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type {
  AgentModeOption,
  ConversationDetail,
  ConversationSummary,
} from '@spark-outpost/contracts';
import { api, CAPABILITIES_STALE_MS, capabilitiesQuery, queryKeys } from '../api/client.ts';
import { projectKeys, projectsApi } from '../api/projects.ts';
import { providerName } from '../chat/provider-name.ts';
import { ActivityLog } from './ActivityLog.tsx';
import type { PeekTarget } from './DiffPeek.tsx';
import { FileView } from './FileView.tsx';
import { activityLines, baseName, runActivity, stepCount, withChanges } from './home-model.ts';
import { sessionState } from './island-model.ts';
import { OpenButton } from './now-parts.tsx';
import { sessionFacts, sessionNotes, showsFacts } from './session-summary.ts';
import { SessionSummary } from './SessionSummary.tsx';
import { chatAgent } from './use-island-data.ts';
import { terminalFacts, type LinePart } from '../sessions/session-line.ts';
import { useSessionLine } from '../sessions/use-session-line.ts';
import { useFileView } from './use-file-view.ts';
import { useRunChanges } from './use-run-changes.ts';

const NO_MODES: readonly AgentModeOption[] = [];
function terminalParts(hasLog: boolean, summed: boolean): LinePart[] {
  const counts: LinePart[] = hasLog ? ['steps', 'subagents'] : ['step', 'steps', 'subagents'];
  return summed ? [...counts, 'model'] : counts;
}

function taskOf(detail: ConversationDetail | undefined, runIds: readonly string[]): string | null {
  if (!detail) return null;
  return detail.tasks.find((task) => runIds.some((id) => task.runIds.includes(id)))?.id ?? null;
}

function agentLine(
  chat: ConversationSummary,
  detail: ConversationDetail | undefined,
  terminalModel: string | null,
): string {
  if (chat.sessionType === 'terminal' && chat.terminal)
    return [providerName(chat.terminal.provider), terminalModel].filter(Boolean).join(' · ');
  const agent = chatAgent(chat, detail);
  const model = detail?.runs
    .find((run) => run.id === chat.latestRun?.id)
    ?.model?.replace(/\[.*\]$/, '');
  return [chat.teammate?.name ?? agent.name, model].filter(Boolean).join(' · ');
}

function focusReply(chatId: string) {
  requestAnimationFrame(() => {
    document.getElementById(`isl-reply-${chatId}`)?.focus({ preventScroll: true });
  });
}

function useFacts(
  chat: ConversationSummary,
  detail: ConversationDetail | undefined,
  agent: string,
) {
  const projects = useQuery({ queryKey: projectKeys.all, queryFn: projectsApi.list });
  const session = chat.sessionType === 'terminal' ? chat.terminal : null;
  const capabilities = useQuery({
    ...capabilitiesQuery(session?.provider ?? 'claude'),
    enabled: Boolean(session),
    staleTime: CAPABILITIES_STALE_MS,
  });
  const modes = capabilities.data?.modes ?? NO_MODES;
  return useMemo(() => {
    const names = new Map((projects.data ?? []).map((project) => [project.id, project.name]));
    return sessionFacts(chat, detail, names, modes, agent);
  }, [chat, detail, projects.data, modes, agent]);
}

interface NowSessionProps {
  chat: ConversationSummary;
  reduced: boolean;
  onOpenHere: (id: string) => void;
  onOpenChat: (id: string) => void;
  onPeek: (target: PeekTarget) => void;
}

export function NowSession({ chat, reduced, onOpenHere, onOpenChat, onPeek }: NowSessionProps) {
  const detail = useQuery({
    queryKey: queryKeys.conversation(chat.id),
    queryFn: () => api.getConversation(chat.id),
  });
  const state = sessionState(chat);
  const live = state === 'working' || state === 'waiting';
  const activity = useMemo(() => runActivity(chat, detail.data), [chat, detail.data]);
  const plain = useMemo(() => activityLines(activity.steps, live), [activity, live]);
  const taskId = taskOf(detail.data, activity.runIds);
  const edits = plain.some((line) => line.kind === 'edit' && line.path !== null);
  const changes = useRunChanges(taskId, activity.runIds, edits);
  const lines = useMemo(
    () => withChanges(plain, activity.runIds, changes.entries),
    [plain, activity.runIds, changes.entries],
  );
  const count = stepCount(chat.latestRun?.progress);
  const hasLog = lines.length > 0;
  const terminalLine = useSessionLine(chat);
  const summed = showsFacts(state, hasLog);
  const terminalText = terminalFacts(chat, terminalLine, terminalParts(hasLog, summed));
  const notes = useMemo(
    () => sessionNotes(chat, state, detail.data, hasLog, terminalText),
    [chat, state, detail.data, hasLog, terminalText],
  );
  const agent = agentLine(chat, detail.data, summed ? null : terminalLine.model);
  const facts = useFacts(chat, detail.data, agent);
  const step = live && activity.runId ? `${activity.runId}:${activity.steps.length}` : null;
  const file = useFileView(chat.id, step, activity.runIds);
  const last = lines.at(-1);
  const current =
    file !== null && last?.state === 'active' && last.path !== null
      ? baseName(last.path) === file.name
      : false;
  const reply =
    chat.sessionType === 'terminal'
      ? null
      : () => {
          onOpenHere(chat.id);
          focusReply(chat.id);
        };
  return (
    <>
      <div className="isl-now-text">
        <div className="isl-now-head">
          <span className="isl-now-dot" data-state={state} aria-hidden="true" />
          <b className="isl-now-title" title={chat.title}>
            {chat.title}
          </b>
          {!summed && (
            <span className="isl-now-agent" title={agent}>
              {agent}
            </span>
          )}
          <span className="isl-sp" />
          {count && (
            <span className="isl-now-steps">
              <span className="sr-only">
                Step {count.current} of {count.total}
              </span>
              <span aria-hidden="true">
                <span key={count.current} className="isl-tick">
                  {count.current}
                </span>
                /{count.total}
              </span>
            </span>
          )}
          <OpenButton chat={chat} onOpenHere={onOpenHere} onOpenChat={onOpenChat} />
        </div>
        <div className="isl-now-body">
          {detail.isPending ? (
            <div className="isl-skl isl-now-skl" aria-hidden="true">
              <i />
              <i style={{ width: '64%' }} />
            </div>
          ) : (
            <>
              {hasLog && (
                <ActivityLog
                  lines={lines}
                  reduced={reduced}
                  onPeek={(change) => {
                    if (taskId)
                      onPeek({ chatId: chat.id, taskId, version: changes.version, change });
                  }}
                />
              )}
              <SessionSummary
                title={chat.title}
                notes={notes}
                facts={summed ? facts : null}
                onReply={reply}
              />
            </>
          )}
        </div>
      </div>
      {file && <FileView view={file} current={current} />}
    </>
  );
}
