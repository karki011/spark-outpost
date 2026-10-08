import './chat-rail.css';
import { memo, useCallback, useRef } from 'react';
import { AnimatePresence } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import type {
  ConversationDetail,
  InvolvementLevel,
  Project,
  ProviderId,
  TaskOverview,
} from '@spark-outpost/contracts';
import { capabilitiesQuery } from '../../api/client.ts';
import { crewAgents } from '../../crew/crew-projection.ts';
import { chatModelName } from '../../crew/auto-route.ts';
import { latestOrchestration, orchestrationsInOrder } from '../../crew/conversation-crew.ts';
import { diffApi, diffKeys } from '../../diff/diff-api.ts';
import type { WorkTab } from '../../tasks/TaskDetails.tsx';
import { useTooltip } from '../../ui/Tooltip.tsx';
import { contextPercent, latestContext } from '../../usage/format.ts';
import { currentModel, shortLabel } from '../composer/model-options.ts';
import { permissionState } from '../composer/mode-summary.ts';
import { requestProjectMenu } from '../project/project-menu-request.ts';
import { useChatWorkspace } from '../project/use-chat-workspace.ts';
import { providerName } from '../provider-name.ts';
import { prWatchesQuery } from '../pull-request/pr-follow-up-api.ts';
import { primaryPull } from '../pull-request/pull-request-model.ts';
import { RailToggleIcon } from './RailIcons.tsx';
import { RailSummary } from './RailSummary.tsx';
import { RailTasks } from './RailTasks.tsx';
import { RailTv } from './RailTv.tsx';
import { railRows, type RailAction } from './rail-model.ts';
import { useRoomInThread } from './use-rail-layout.ts';

interface ChatRailProps {
  detail: ConversationDetail;
  repos: readonly Project[];
  taskId: string | null;
  task: TaskOverview | null;
  autonomy: InvolvementLevel | null;
  running: boolean;
  collapsed: boolean;
  onCollapse(collapsed: boolean): void;
  onTab(tab: WorkTab): void;
  onAutonomy(): void;
  onChanges(): void;
}

function RailToggle({ open, onToggle }: { open: boolean; onToggle(): void }) {
  const label = open ? 'Hide context rail' : 'Show context rail';
  const tip = useTooltip(label);
  return (
    <>
      <button
        type="button"
        className={open ? 'crail-toggle' : 'crail-toggle crail-show'}
        aria-label={label}
        aria-expanded={open}
        aria-controls="chat-rail"
        {...tip.triggerProps}
        onClick={onToggle}
      >
        <RailToggleIcon open={open} />
      </button>
      {tip.tooltip}
    </>
  );
}

export const ChatRail = memo(function ChatRail(props: ChatRailProps) {
  if (props.collapsed) {
    return <RailToggle open={false} onToggle={() => props.onCollapse(false)} />;
  }
  return <OpenRail {...props} />;
});

function OpenRail({
  detail,
  repos,
  taskId,
  task,
  autonomy,
  running,
  onCollapse,
  onTab,
  onAutonomy,
  onChanges,
}: ChatRailProps) {
  const conversationId = detail.conversation.id;
  const railRef = useRef<HTMLElement>(null);
  useRoomInThread(railRef);
  const { settings } = detail;
  const provider = settings.provider ?? '';
  const capabilities = useQuery(capabilitiesQuery((provider || 'claude') as ProviderId));
  const changes = useQuery({
    queryKey: diffKeys.summary(taskId ?? ''),
    queryFn: () => diffApi.summary(taskId ?? ''),
    enabled: taskId !== null,
  });
  const watches = useQuery(prWatchesQuery(conversationId));
  const workspace = useChatWorkspace(conversationId, Boolean(detail.conversation.branch));

  const list = watches.data?.watches ?? [];
  const watch = primaryPull(list);
  const branch = workspace.data?.current ?? null;
  const reading = latestContext(detail.runs, settings.provider);
  const picked = currentModel(settings, capabilities.data);
  const rows = railRows({
    repoNames: repos.map((repo) => repo.name),
    branch: branch ? { name: branch.branch, worktree: branch.worktree } : null,
    provider: providerName(provider),
    model: chatModelName(
      settings.routing,
      picked ? shortLabel(picked.label) : null,
      orchestrationsInOrder(detail),
    ),
    mode: permissionState(settings, capabilities.data).label,
    autonomy,
    changes: changes.data ?? null,
    watch,
    pulls: list.length,
    usage: detail.usageTotals,
    contextPercent: reading ? contextPercent(reading.used, reading.size) : null,
    hasTask: taskId !== null,
  });
  const openTasks = useCallback(() => onTab('tasks'), [onTab]);
  const orchestration = running ? latestOrchestration(detail) : null;
  const agents = orchestration ? crewAgents(orchestration, detail.activity) : [];

  const act = (action: RailAction) => {
    if (action.kind === 'project') requestProjectMenu(conversationId);
    if (action.kind === 'tab') onTab(action.tab);
    if (action.kind === 'autonomy') onAutonomy();
    if (action.kind === 'changes') onChanges();
  };

  return (
    <section ref={railRef} className="crail" id="chat-rail" aria-label="Chat context">
      <div className="crail-head">
        <h3 className="crail-title">Context</h3>
        <RailToggle open onToggle={() => onCollapse(true)} />
      </div>
      <RailSummary rows={rows} provider={provider} onAction={act} />
      {task && <RailTasks task={task} onOpen={openTasks} />}
      <AnimatePresence>
        {agents.length > 0 && <RailTv key="tv" conversationId={conversationId} agents={agents} />}
      </AnimatePresence>
    </section>
  );
}
