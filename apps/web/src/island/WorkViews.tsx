import { useEffect, useState } from 'react';
import {
  agentRoleLabel,
  agentRoleSchema,
  type ConversationDetail,
  type ConversationSummary,
} from '@spark-outpost/contracts';
import { formatDuration } from '../audit/audit-model.ts';
import { CrewBlob } from '../crew/CrewBlob.tsx';
import { progressPercent } from '../home/home-model.ts';
import type { Voice } from '../spark/voice.ts';
import { formatCost } from '../usage/format.ts';
import { crewLine, doneLine, type VoiceRole } from './crew-voice.ts';
import { crewQuirk, isCheckStep } from './island-mood.ts';
import { STREAK_SPARKLE, type Moment } from './island-model.ts';
import { elapsedText, ProviderTag, Who } from './island-parts.tsx';
import type { ChatAgent } from './use-island-data.ts';

export interface WorkItem {
  chat: ConversationSummary;
  agent: ChatAgent;
  detail: ConversationDetail | undefined;
}

const TICK_MS = 2400;

export function roleLabel(role: string | null): string | null {
  const parsed = agentRoleSchema.safeParse(role);
  if (parsed.success) return agentRoleLabel(parsed.data);
  return role === 'jev' ? 'Planner' : null;
}

function topRun(detail: ConversationDetail | undefined) {
  return detail?.runs.filter((run) => !run.parentRunId).at(-1) ?? null;
}

export function workLine(voice: Voice, item: WorkItem): string {
  const step = item.chat.latestRun?.step ?? item.agent.line ?? 'Working';
  return crewLine(voice, isCheckStep(step) ? 'checks' : 'working', {
    role: item.agent.role as VoiceRole | null,
    who: item.agent.name,
    fact: step,
    seed: item.chat.latestRun?.id ?? item.chat.id,
  });
}

function costOf(items: readonly WorkItem[]): number | null {
  const costs = items.map((item) => item.detail?.usageTotals.costUsd ?? null);
  return costs.every((cost) => cost === null)
    ? null
    : costs.reduce<number>((sum, cost) => sum + (cost ?? 0), 0);
}

export function LiveView({
  items,
  voice,
  now,
  tag,
  still,
}: {
  items: readonly WorkItem[];
  voice: Voice;
  now: number;
  tag: string | null;
  still: boolean;
}) {
  const [tick, setTick] = useState(0);
  const lines = items.map((item) => ({ item, text: workLine(voice, item) }));
  useEffect(() => {
    if (lines.length < 2) return;
    const timer = setInterval(() => setTick((value) => value + 1), TICK_MS);
    return () => clearInterval(timer);
  }, [lines.length]);
  const current = lines[tick % Math.max(1, lines.length)];
  const cost = costOf(items);
  const first = items[0];
  return (
    <div className="isl-live">
      <div className="isl-ticker" aria-hidden="true">
        {current && (
          <div key={`${tick}-${current.item.chat.id}`} className="isl-tline">
            <span
              className="isl-pdot"
              style={{
                ['--pc' as string]: `var(--c-${current.item.agent.provider ?? 'claude'}, var(--faint))`,
              }}
            />
            <span className={still ? 't' : 't shim'}>{current.text}</span>
          </div>
        )}
      </div>
      {tag && <span className="isl-qtag">{tag}</span>}
      <span className="isl-livemeta mono">
        <b>{elapsedText(topRun(first?.detail)?.startedAt ?? null, now)}</b>
        {cost !== null && (
          <>
            {' · '}
            <b>{formatCost(cost)}</b>
          </>
        )}
      </span>
      <div className="isl-busyline" aria-hidden="true">
        <i />
      </div>
    </div>
  );
}

function Segments({ chat }: { chat: ConversationSummary }) {
  const progress = chat.latestRun?.progress;
  if (!progress || progressPercent(progress) === null) return null;
  return (
    <div
      className="isl-segs"
      role="img"
      aria-label={`Step ${progress.done + 1} of ${progress.total}`}
    >
      {Array.from({ length: progress.total }, (_, index) => (
        <i
          key={index}
          className={
            index < progress.done ? 'done' : index < progress.done + progress.active ? 'act' : ''
          }
        />
      ))}
    </div>
  );
}

export function OverviewView({
  items,
  voice,
  now,
  onOpenChat,
}: {
  items: readonly WorkItem[];
  voice: Voice;
  now: number;
  onOpenChat: (id: string) => void;
}) {
  const crew = items.flatMap((item) =>
    item.agent.crew.length > 0
      ? item.agent.crew
          .filter(
            (agent) =>
              agent.state === 'working' || agent.state === 'thinking' || agent.state === 'waiting',
          )
          .map((agent) => ({ item, agent }))
      : [],
  );
  const first = items[0];
  return (
    <div className="isl-card plain isl-overview">
      <div className="isl-rows">
        {items.map((item) => (
          <button
            key={item.chat.id}
            type="button"
            className="isl-row"
            onClick={() => onOpenChat(item.chat.id)}
          >
            <span
              className="isl-row-blob"
              data-quirk={crewQuirk({
                role: item.agent.role,
                state: 'working',
                step: item.chat.latestRun?.step ?? null,
                checksPassed: false,
              })}
            >
              <CrewBlob
                name={item.agent.name}
                provider={item.agent.provider ?? 'claude'}
                state="working"
                size={26}
              />
            </span>
            <span className="isl-row-main">
              <span className="n">
                {item.agent.name}{' '}
                {roleLabel(item.agent.role) && <span>· {roleLabel(item.agent.role)}</span>}
              </span>
              <span className="s">{workLine(voice, item)}</span>
            </span>
            <span className="r">
              <ProviderTag provider={item.agent.provider} />
              <span className="mono">
                {elapsedText(topRun(item.detail)?.startedAt ?? null, now)}
              </span>
            </span>
          </button>
        ))}
      </div>
      {crew.length > 1 && (
        <div className="isl-crew-row" aria-label="Crew at work">
          {crew.map(({ agent }) => (
            <span
              key={agent.id}
              className="isl-crew-mini"
              title={`${agent.name} · ${roleLabel(agent.role) ?? ''}`}
              data-quirk={crewQuirk({
                role: agent.role,
                state: agent.state === 'waiting' ? 'waiting' : 'working',
                step: agent.line,
                checksPassed: false,
              })}
            >
              <CrewBlob name={agent.name} provider={agent.provider} state={agent.state} size={18} />
              <small>{agent.name}</small>
            </span>
          ))}
        </div>
      )}
      {first && <Segments chat={first.chat} />}
      <div className="isl-ovfoot">
        <span>{first?.chat.title}</span>
        {first && (
          <button type="button" className="isl-btn link" onClick={() => onOpenChat(first.chat.id)}>
            Open chat
          </button>
        )}
      </div>
    </div>
  );
}

function lastReply(detail: ConversationDetail | undefined): string | null {
  return (
    detail?.messages.findLast((message) => message.role === 'assistant')?.content.trim() || null
  );
}

interface MomentViewProps {
  moment: Moment;
  item: WorkItem | null;
  voice: Voice;
  reply: boolean;
  streak: number;
  onOpenChat: (id: string) => void;
  onReply: (chat: ConversationSummary) => void;
}

export function MomentView({
  moment,
  item,
  voice,
  reply,
  streak,
  onOpenChat,
  onReply,
}: MomentViewProps) {
  if (!item) return null;
  const { chat, agent, detail } = item;
  const run = topRun(detail);
  const cost = detail?.usageTotals.costUsd ?? null;
  const duration =
    run?.startedAt && run.finishedAt
      ? Date.parse(run.finishedAt) - Date.parse(run.startedAt)
      : null;
  const done = moment.kind === 'done';
  const text = reply ? lastReply(detail) : null;
  const long = (text?.length ?? 0) > 240;
  const meta = [
    cost !== null ? formatCost(cost) : null,
    duration !== null ? formatDuration(duration) : null,
  ].filter(Boolean);
  return (
    <div className="isl-card" data-wash={done ? 'success' : 'danger'}>
      <Who
        name={agent.name}
        role={roleLabel(agent.role)}
        provider={agent.provider}
        title={reply ? chat.title : null}
        expression={done ? 'happy' : 'sad'}
      />
      <div className="isl-ttl">
        {reply
          ? `${agent.name} replied`
          : done
            ? `${chat.title} is done`
            : `${chat.title} couldn’t finish`}
      </div>
      {text && (
        <div
          className={long ? 'isl-reply scroll' : 'isl-reply clamp'}
          tabIndex={0}
          aria-label={long ? 'Answer, scrollable' : 'Reply preview'}
        >
          {text}
        </div>
      )}
      {!done && (
        <p className="isl-dangerline">
          {chat.latestRun?.error ?? 'It stopped before the work was done.'}
        </p>
      )}
      {done && !reply && (
        <p className="isl-hint">
          {doneLine(
            voice,
            meta.length > 0 ? `finished for ${meta.join(' in ')}` : 'all finished',
            moment.runId,
          )}
        </p>
      )}
      {meta.length > 0 && (
        <div className="isl-meta mono">
          {meta.map((part) => (
            <span key={part}>{part}</span>
          ))}
          {done && streak >= STREAK_SPARKLE && (
            <span className="isl-streak">{streak} in a row</span>
          )}
        </div>
      )}
      <div className="isl-acts">
        {reply && (
          <button type="button" className="isl-btn primary" onClick={() => onReply(chat)}>
            Reply
          </button>
        )}
        <button
          type="button"
          className={reply ? 'isl-btn' : 'isl-btn primary'}
          onClick={() => onOpenChat(chat.id)}
        >
          {reply ? 'Open in Spark' : 'Open chat'}
        </button>
      </div>
    </div>
  );
}
