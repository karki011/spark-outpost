import type { ReactNode } from 'react';
import type { ConversationDetail, MemberMessage, Run } from '@spark-outpost/contracts';
import type { SteerMark } from '../rows/turn-rows.ts';
import { SteerGroup } from '../steer/SteeredMessage.tsx';
import { steerMarks, type SteerSeen } from '../steer/steer-model.ts';

export interface BlockSteers {
  marks: readonly SteerMark[];
  view: (ids: readonly string[], seen: SteerSeen) => ReactNode;
}

export function blockSteers(
  messages: readonly MemberMessage[],
  detail: ConversationDetail,
  run: Run,
): BlockSteers | undefined {
  if (messages.length === 0) return undefined;
  return {
    marks: steerMarks(messages),
    view: (ids, seen) => (
      <SteerGroup
        messages={messages.filter((message) => ids.includes(message.id))}
        detail={detail}
        run={run}
        crew
        seen={seen}
      />
    ),
  };
}
