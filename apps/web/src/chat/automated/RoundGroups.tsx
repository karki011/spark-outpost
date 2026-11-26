import './automated-turn.css';
import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { isTerminalRunStatus, type ConversationDetail, type Run } from '@spark-outpost/contracts';
import { ChevronIcon, RefreshIcon } from '../../ui/icons.tsx';
import { prWatchesQuery } from '../pull-request/pr-follow-up-api.ts';
import { usePaneId } from '../split/chat-pane.ts';
import { turnSteers } from '../steer/steer-model.ts';
import { turnRunIds } from '../turn-props.ts';
import { opensOnItsOwn, waitsOnYou } from './automated-model.ts';
import {
  groupSubtitle,
  groupTitle,
  roundOfTurn,
  roundsByPull,
  type RoundMember,
} from './round-card-model.ts';

interface RoundGroupProps {
  detail: ConversationDetail;
  runs: readonly Run[];
  members: readonly RoundMember[];
  children: ReactNode;
}

function opensItself(detail: ConversationDetail, run: Run): boolean {
  if (!isTerminalRunStatus(run.status)) return true;
  const waiting = waitsOnYou(detail.approvals, turnRunIds(detail, run.id));
  const steered = turnSteers(detail, run.id).length > 0;
  return opensOnItsOwn(run.status, { waiting, steered });
}

function RoundGroup({ detail, runs, members, children }: RoundGroupProps) {
  const [chosen, setChosen] = useState<boolean | null>(null);
  const bodyId = usePaneId(`round-group-${runs[0]!.id}`);
  const live = runs.find((run) => !isTerminalRunStatus(run.status)) ?? null;
  const open = chosen ?? runs.some((run) => opensItself(detail, run));
  return (
    <div className="auto-turn round-group" data-open={open} data-live={live !== null}>
      <div className="auto-turn-row">
        <button
          type="button"
          className="auto-turn-toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setChosen(!open)}
        >
          <ChevronIcon />
          <span className="auto-turn-ic" aria-hidden="true">
            <RefreshIcon />
          </span>
          <b>{groupTitle(members)}</b>
          <span>{groupSubtitle(members, live?.id ?? null)}</span>
        </button>
      </div>
      <div id={bodyId} className="round-group-body" hidden={!open}>
        {children}
      </div>
    </div>
  );
}

interface RoundGroupsProps {
  detail: ConversationDetail;
  runs: readonly Run[];
  render: (run: Run) => ReactNode;
}

export function RoundGroups({ detail, runs, render }: RoundGroupsProps) {
  const watches = useQuery({
    ...prWatchesQuery(detail.conversation.id),
    select: (list) => list.watches,
  }).data;
  const members = runs.map((run) => ({ runId: run.id, found: roundOfTurn(watches ?? [], run.id) }));
  const byId = new Map(runs.map((run) => [run.id, run]));
  return roundsByPull(members).map((group) => {
    const groupRuns = group.map((member) => byId.get(member.runId)!);
    if (group.length < 2) return groupRuns.map(render);
    return (
      <RoundGroup key={groupRuns[0]!.id} detail={detail} runs={groupRuns} members={group}>
        {groupRuns.map(render)}
      </RoundGroup>
    );
  });
}
