import './chat-rail.css';
import { memo, useMemo, useRef } from 'react';
import { AnimatePresence } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import type {
  ConversationDetail,
  InvolvementLevel,
  Project,
  ProviderId,
} from '@spark-outpost/contracts';
import { capabilitiesQuery } from '../../api/client.ts';
import { crewAgents } from '../../crew/crew-projection.ts';
import { latestOrchestration } from '../../crew/conversation-crew.ts';
import { diffApi, diffKeys } from '../../diff/diff-api.ts';
import type { WorkTab } from '../../tasks/TaskDetails.tsx';
import { useTooltip } from '../../ui/Tooltip.tsx';
import { contextPercent, latestContext } from '../../usage/format.ts';
import { currentModel, shortLabel } from '../composer/model-options.ts';
import { permissionState } from '../composer/mode-summary.ts';
import { requestProjectMenu } from '../project/project-menu-request.ts';
import { useChatWorkspace } from '../project/use-chat-workspace.ts';
import { providerName } from '../provider-name.ts';
import { prFollowUpApi, prWatchesKey } from '../pull-request/pr-follow-up-api.ts';
import { RailToggleIcon } from './RailIcons.tsx';
import { RailOutline } from './RailOutline.tsx';
import { RailSummary } from './RailSummary.tsx';
import { RailTv } from './RailTv.tsx';
import { chatOutline } from './outline-model.ts';
import { railRows, type RailAction } from './rail-model.ts';
import { useRoomInThread } from './use-rail-layout.ts';

interface ChatRailProps {
  detail: ConversationDetail;
  repos: readonly Project[];
  taskId: string | null;
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
  const watches = useQuery({
    queryKey: prWatchesKey(conversationId),
    queryFn: () => prFollowUpApi.get(conversationId),
  });
  const workspace = useChatWorkspace(conversationId, Boolean(detail.conversation.branch));

  const list = watches.data?.watches ?? [];
  const watch = list.find((entry) => entry.phase !== 'done') ?? list[0] ?? null;
  const branch = workspace.data?.current ?? null;
  const reading = latestContext(detail.runs, settings.provider);
  const model = currentModel(settings, capabilities.data);
  const rows = railRows({
    repoNames: repos.map((repo) => repo.name),
    branch: branch ? { name: branch.branch, worktree: branch.worktree } : null,
    provider: providerName(provider),
    model: model ? shortLabel(model.label) : null,
    mode: permissionState(settings, capabilities.data).label,
    autonomy,
    changes: changes.data ?? null,
    watch,
    usage: detail.usageTotals,
    contextPercent: reading ? contextPercent(reading.used, reading.size) : null,
    hasTask: taskId !== null,
  });
  const changedRuns = changes.data?.runs;
  const { messages, runs, approvals, plans } = detail;
  const outline = useMemo(
    () =>
      chatOutline(
        { messages, runs, approvals, plans },
        {
          changedRunIds: new Set(
            (changedRuns ?? [])
              .filter((run) => run.files > 0 && !run.revertedAt)
              .map((run) => run.runId),
          ),
          prUrls: (watches.data?.watches ?? []).map((entry) => entry.url),
        },
      ),
    [messages, runs, approvals, plans, changedRuns, watches.data],
  );
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
      <RailOutline entries={outline} />
      <AnimatePresence>
        {agents.length > 0 && <RailTv key="tv" conversationId={conversationId} agents={agents} />}
      </AnimatePresence>
    </section>
  );
}
