import {
  EMPTY_CONVERSATION_USAGE,
  type Attachment,
  type TaskOverview,
} from '@spark-outpost/contracts';
import { useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, queryKeys } from '../api/client.ts';
import { isConnectionLoss } from '../app/connection/connection-failure.ts';
import { setupApi, setupKey } from '../api/setup.ts';
import { AuditDialog } from '../audit/AuditDialog.tsx';
import { ChatHeaderMenu } from '../audit/ChatHeaderMenu.tsx';
import { AgentTvButton } from '../crew/AgentTvButton.tsx';
import {
  belongsTo,
  conversationCrew,
  crewOrchestration,
  latestOrchestration,
} from '../crew/conversation-crew.ts';
import { SidebarToggle } from '../conversations/sidebar-layout.tsx';
import { ThemePicker } from '../theme/ThemePicker.tsx';
import { useTaskPanel } from '../tasks/work-panel-state.ts';
import { ViewChangesContext } from '../tasks/view-changes.ts';
import { WorkPanel, type WorkTab } from '../tasks/WorkPanel.tsx';
import { WorkPanelToggle } from '../tasks/WorkPanelToggle.tsx';
import { DropOverlay } from './attachments/DropOverlay.tsx';
import { useAttachments } from './attachments/use-attachments.ts';
import { useFileDrop } from './attachments/use-file-drop.ts';
import { Composer } from './Composer.tsx';
import { repoSummary } from './project/repo-list.ts';
import { useLinkedProjects } from './project/use-chat-repos.ts';
import { Thread } from './Thread.tsx';
import { activeRun } from './turns.ts';

const NO_REPOS: string[] = [];
const NO_TASKS: TaskOverview[] = [];

export interface OutgoingMessage {
  content: string;
  attachments: Attachment[];
}

export function ChatView({ conversationId }: { conversationId: string }) {
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: queryKeys.conversation(conversationId),
    queryFn: () => api.getConversation(conversationId),
  });

  const setup = useQuery({ queryKey: setupKey, queryFn: setupApi.get });
  const connected = setup.data?.providers.filter((provider) => provider.connection) ?? [];
  const jevConnected =
    setup.data?.advisors.some((advisor) => advisor.id === 'jev' && advisor.connection) ?? false;

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.conversation(conversationId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations, exact: true }),
    ]);

  const send = useMutation({
    mutationFn: (message: OutgoingMessage) =>
      api.sendMessage(
        conversationId,
        crypto.randomUUID(),
        message.content,
        message.attachments.map((attachment) => attachment.id),
      ),
    onSuccess: refresh,
  });
  const attachments = useAttachments();
  const drop = useFileDrop(attachments.add);
  const stop = useMutation({ mutationFn: api.cancelRun, onSuccess: refresh });
  const startFresh = useMutation({ mutationFn: () => api.startFreshSession(conversationId) });

  const running = activeRun(detail.data);
  const title = detail.data?.conversation.title ?? '';
  const repos = useLinkedProjects(detail.data?.conversation.projectIds ?? NO_REPOS);
  const panel = useTaskPanel(detail.data?.tasks ?? NO_TASKS);
  const crew = conversationCrew(detail.data);
  const orchestration = latestOrchestration(detail.data);
  const task = panel.task;
  const crewRun = crewOrchestration(detail.data);
  const taskCrew = task && crewRun && belongsTo(task, crewRun) ? crewRun : null;
  const [auditOpen, setAuditOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<WorkTab>('tasks');
  const viewChanges = task
    ? (taskId?: string) => {
        setPanelTab('changes');
        if (taskId) panel.openTask(taskId);
        else panel.setOpen(true);
      }
    : null;
  const canAudit = (detail.data?.runs.length ?? 0) > 0;
  const openAudit = canAudit ? () => setAuditOpen(true) : undefined;

  return (
    <ViewChangesContext value={viewChanges}>
      <main className="main" {...drop.handlers}>
        <header className="head">
          <SidebarToggle />
          {repos.length > 0 && (
            <span className="crumb" title={repos.map((repo) => repo.rootPath).join('\n')}>
              {repoSummary(repos.map((repo) => repo.name))} /
            </span>
          )}
          <h1
            className="chat-title"
            title={
              detail.data?.conversation.titleSource === 'auto' ? 'Renamed by Spark' : undefined
            }
          >
            {title}
          </h1>
          <div className="head-r">
            <WorkPanelToggle panel={panel} waiting={(task?.summary.waiting ?? 0) > 0} />
            {openAudit && (
              <ChatHeaderMenu onAudit={openAudit} onStartFresh={() => startFresh.mutate()} />
            )}
            <AgentTvButton conversationId={conversationId} agents={crew} />
            <ThemePicker />
          </div>
        </header>
        {detail.isError && !isConnectionLoss(detail.error) && (
          <p className="error-line" role="alert">
            {detail.error.message}
          </p>
        )}
        {detail.data && (
          <Thread
            detail={detail.data}
            repos={repos}
            pendingMessage={send.isPending ? send.variables : null}
            panelOpen={panel.open}
            onOpenTask={panel.openTask}
          />
        )}
        <Composer
          conversationId={conversationId}
          repos={repos}
          settings={detail.data?.settings ?? null}
          providers={connected}
          runs={detail.data?.runs ?? []}
          orchestration={orchestration}
          jevConnected={jevConnected}
          usageTotals={detail.data?.usageTotals ?? EMPTY_CONVERSATION_USAGE}
          busy={running !== null}
          sending={send.isPending}
          error={send.error?.message ?? stop.error?.message ?? null}
          attachments={attachments}
          onSend={async (content, files) => {
            await send.mutateAsync({ content, attachments: files });
          }}
          onStop={() => {
            if (running) stop.mutate(running.id);
          }}
          {...(openAudit ? { onAudit: openAudit } : {})}
        />
        <DropOverlay visible={drop.dragging} />
      </main>
      {task && (
        <WorkPanel
          conversationId={conversationId}
          task={task}
          open={panel.open}
          wide={panel.wide}
          tab={panelTab}
          onTab={setPanelTab}
          onClose={() => panel.setOpen(false)}
          orchestration={taskCrew}
          agents={taskCrew ? crew : []}
          roots={repos.map((repo) => repo.rootPath)}
          runs={detail.data?.runs ?? []}
          width={panel.width}
          onWidth={panel.setWidth}
          {...(openAudit ? { onAudit: openAudit } : {})}
        />
      )}
      <AnimatePresence>
        {auditOpen && (
          <AuditDialog
            conversationId={conversationId}
            title={title}
            onClose={() => setAuditOpen(false)}
          />
        )}
      </AnimatePresence>
    </ViewChangesContext>
  );
}
