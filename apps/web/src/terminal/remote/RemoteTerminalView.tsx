import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DEFAULT_BUSY_ENTER,
  isTrackedTerminalProvider,
  terminalLabel,
  terminalProviderName,
  untrackedTerminalRefusal,
  type ConversationSummary,
  type TerminalRemoteView,
} from '@spark-outpost/contracts';
import { setupApi, setupKey } from '../../api/setup.ts';
import { useStickToBottom } from '../../chat/use-stick-to-bottom.ts';
import { PHONE_SWITCH_OFF, useRemoteClient } from '../../phone/use-remote-client.ts';
import { LiveElapsed } from '../../ui/LiveElapsed.tsx';
import { QueryWait } from '../../ui/loading/QueryWait.tsx';
import { Skeleton } from '../../ui/loading/Skeleton.tsx';
import { terminalRemoteApi, terminalRemoteKey } from '../terminal-api.ts';
import { RemoteTerminalApproval } from './RemoteTerminalApproval.tsx';
import { RemoteTerminalComposer } from './RemoteTerminalComposer.tsx';
import { RemoteTerminalItems } from './RemoteTerminalItems.tsx';
import './remote-terminal.css';

const LIVE_REFRESH_MS = 10_000;
const STOPPED_REFRESH_MS = 30_000;

function failure(error: unknown): string {
  return error instanceof Error ? error.message : 'That did not reach the session. Try again.';
}

function blockedReason(view: TerminalRemoteView): string | null {
  if (!view.running) return 'This session isn’t running. Start it again on your Mac.';
  if (!isTrackedTerminalProvider(view.provider)) return untrackedTerminalRefusal(view.provider);
  if (view.approval) return 'Answer the agent first, then send your message.';
  if (view.state === 'waiting_for_permission')
    return 'The agent is waiting for permission. Answer it on your Mac.';
  if (view.state === 'waiting_for_input')
    return 'The agent is asking a question. Answer it on your Mac.';
  return null;
}

export function RemoteTerminalView({ chat }: { chat: ConversationSummary }) {
  const { allows } = useRemoteClient();
  if (!allows('terminal'))
    return (
      <section className="native-workspace remote">
        <p>Open this Terminal session on your Mac.</p>
        <p className="rt-note">
          {PHONE_SWITCH_OFF}: following, typing in and stopping Terminal sessions.
        </p>
      </section>
    );
  return <RemoteTerminalSession chat={chat} approve={allows('terminalApprove')} />;
}

function RemoteTerminalSession({ chat, approve }: { chat: ConversationSummary; approve: boolean }) {
  const client = useQueryClient();
  const key = terminalRemoteKey(chat.id);
  const view = useQuery({
    queryKey: key,
    queryFn: () => terminalRemoteApi.view(chat.id),
    refetchInterval: (query) =>
      query.state.data?.running === false ? STOPPED_REFRESH_MS : LIVE_REFRESH_MS,
  });
  const setup = useQuery({ queryKey: setupKey, queryFn: setupApi.get });
  const { scrollerRef } = useStickToBottom();
  const [problem, setProblem] = useState<string | null>(null);
  const run = async (action: () => Promise<unknown>): Promise<boolean> => {
    setProblem(null);
    try {
      await action();
      return true;
    } catch (error) {
      setProblem(failure(error));
      return false;
    } finally {
      await client.invalidateQueries({ queryKey: key });
    }
  };
  const data = view.data;
  if (!data)
    return (
      <section className="native-workspace remote" aria-label="Terminal session">
        <QueryWait query={view} what="the session">
          <Skeleton label="Loading the session" rows={5} />
        </QueryWait>
      </section>
    );
  const approval = data.approval;
  return (
    <section className="native-workspace remote rt" aria-label="Terminal session">
      <p className="rt-status">
        <span role="status">
          {terminalProviderName(data.provider)} · {terminalLabel(data.state)}
        </span>
        {data.workingSince && (
          <span className="rt-since">
            {' '}
            for <LiveElapsed since={Date.parse(data.workingSince)} />
          </span>
        )}
      </p>
      <div className="rt-scroll" ref={scrollerRef}>
        <RemoteTerminalItems items={data.items} truncated={data.truncated} />
      </div>
      {approval && (
        <RemoteTerminalApproval
          key={approval.id}
          approval={approval}
          allowed={approve}
          onDecide={(answer) =>
            run(() => terminalRemoteApi.decide(chat.id, { id: approval.id, ...answer }))
          }
        />
      )}
      <RemoteTerminalComposer
        blocked={blockedReason(data)}
        working={data.running && data.state === 'working'}
        preferred={setup.data?.profile.busyEnter ?? DEFAULT_BUSY_ENTER}
        error={problem}
        onSend={(text, now) => run(() => terminalRemoteApi.message(chat.id, text, now))}
        onStop={() => run(() => terminalRemoteApi.interrupt(chat.id))}
      />
    </section>
  );
}
