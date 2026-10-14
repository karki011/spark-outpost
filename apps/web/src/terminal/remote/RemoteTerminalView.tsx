import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { terminalLabel, type ConversationSummary } from '@spark-outpost/contracts';
import { useStickToBottom } from '../../chat/use-stick-to-bottom.ts';
import { PHONE_SWITCH_OFF, useRemoteClient } from '../../phone/use-remote-client.ts';
import { QueryWait } from '../../ui/loading/QueryWait.tsx';
import { Skeleton } from '../../ui/loading/Skeleton.tsx';
import { terminalRemoteApi, terminalRemoteKey } from '../terminal-api.ts';
import { RemoteTerminalApproval } from './RemoteTerminalApproval.tsx';
import { RemoteTerminalComposer } from './RemoteTerminalComposer.tsx';
import { RemoteTerminalItems } from './RemoteTerminalItems.tsx';
import './remote-terminal.css';

const REFRESH_MS = 2000;
const AGENTS = { claude: 'Claude Code', codex: 'Codex' } as const;
const ASKING = 'The agent is asking a question. Answer it on your Mac.';
const ANSWER_FIRST = 'Answer the agent first, then send your message.';

function failure(error: unknown): string {
  return error instanceof Error ? error.message : 'That did not reach the session. Try again.';
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
    refetchInterval: REFRESH_MS,
  });
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
  const asking = data.state === 'waiting_for_input' && !data.approval;
  const blocked = !data.running
    ? 'This session isn’t running. Start it again on your Mac.'
    : data.approval
      ? ANSWER_FIRST
      : asking
        ? ASKING
        : null;
  return (
    <section className="native-workspace remote rt" aria-label="Terminal session">
      <p className="rt-status" role="status">
        {AGENTS[data.provider]} · {terminalLabel(data.state)}
      </p>
      <div className="rt-scroll" ref={scrollerRef}>
        <RemoteTerminalItems items={data.items} truncated={data.truncated} />
      </div>
      {data.approval && (
        <RemoteTerminalApproval
          approval={data.approval}
          here={data.approvalsHere}
          allowed={approve}
          onDecide={async (decision) => {
            await run(() => terminalRemoteApi.decide(chat.id, { id: data.approval!.id, decision }));
          }}
        />
      )}
      {problem && (
        <p className="error-line" role="alert">
          {problem}
        </p>
      )}
      <RemoteTerminalComposer
        blocked={blocked}
        working={data.running && data.state === 'working'}
        onSend={(text) => run(() => terminalRemoteApi.message(chat.id, text))}
        onStop={async () => {
          await run(() => terminalRemoteApi.interrupt(chat.id));
        }}
      />
    </section>
  );
}
