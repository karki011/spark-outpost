import {
  CONVERSATION_SUBAGENT,
  MEMBER_MESSAGE_ACTIVITY,
  nextCrewName,
  STEER_AUTO,
  type MemberMessage,
  type PieceList,
} from '@spark-outpost/contracts';
import { POLICY_VERSION } from '../advisor/policy.ts';
import { addToQueue } from '../persistence/chat-queue.ts';
import { newId } from '../persistence/ids.ts';
import {
  claimChatMessages,
  markMessageSent,
  setMessageReader,
} from '../persistence/member-messages.ts';
import { insertDecision, usedNames } from '../persistence/orchestrations.ts';
import { runningPieceRuns } from '../persistence/piece-notes.ts';
import { pieceListById } from '../persistence/pieces.ts';
import { namedFiles } from '../orchestration/context.ts';
import { callJev } from '../orchestration/jev-calls.ts';
import { runMember } from '../orchestration/members.ts';
import type { MemberRoute } from '../orchestration/routing.ts';
import type { Session } from '../orchestration/session.ts';
import { conversationSeatKey } from '../workflow/conversation-session.ts';
import { runEvents } from '../workflow/run-events.ts';
import { routeRequirement } from './follow-up.ts';
import { midBuildQuestions, readMidBuild, type MidBuildRead } from './mid-build-question.ts';
import { classifySteer } from './steer-rules.ts';

const POLL_MS = 1_000;
const ANSWER_SPAWN = { role: 'coordinator', reason: 'first', escalate: false, note: null } as const;

export interface MidBuildWatch {
  stop(): Promise<void>;
}

export function answerPrompt(message: string, request: string, list: PieceList): string {
  const pieces = list.pieces.map(
    (piece) =>
      `- ${piece.key} · ${piece.title}: ${piece.status} (${piece.owns.join(', ') || 'no files'})`,
  );
  return [
    'The user sent the message below while Builders work on the request. Answer it now. Change no files and start no work: the Builders carry on without you.',
    `## Message\n${message}`,
    `## Request being built\n${request}`,
    `## Pieces right now\n${pieces.join('\n')}`,
  ].join('\n\n');
}

function chatRoute(s: Session): MemberRoute {
  return {
    pick: s.route.chat,
    routedBy: 'rules',
    rule: 'a question during a build stays on the conversation model',
    autoWouldUse: null,
  };
}

async function record(s: Session, read: MidBuildRead, summary: string): Promise<void> {
  await insertDecision(s.deps.db, {
    runId: s.lease.runId,
    purpose: 'route',
    childRunId: null,
    role: null,
    stepIndex: null,
    jevStatus: read.source === 'jev' ? 'answered' : 'not_asked',
    inputTokens: null,
    costUsd: null,
    policyVersion: POLICY_VERSION,
    body: { midBuild: read.kind, source: read.source, confidence: read.confidence, summary },
  }).catch((error: unknown) => console.error('Could not record the mid-build read', error));
}

async function answer(s: Session, list: PieceList, message: MemberMessage): Promise<string> {
  const used = await usedNames(s.deps.db, s.taskId!, 'scout');
  const { result } = await runMember(s, ANSWER_SPAWN, null, {
    seat: {
      role: 'scout',
      name: nextCrewName('scout', used),
      resumeKey: conversationSeatKey(s.taskId!),
      prompt: answerPrompt(message.body, s.input.userRequest, list),
      memberRoute: chatRoute(s),
      route: { answers: message.id },
    },
    announce: { name: CONVERSATION_SUBAGENT, parentMessageId: message.id },
  });
  await setMessageReader(s.deps.db, message.id, result.runId);
  return 'answered read-only while the Builders carry on';
}

function requirementFiles(list: PieceList, text: string): string[] {
  const named = namedFiles([text]);
  if (named.length > 0) return named;
  const steer = classifySteer(text, STEER_AUTO, list.pieces);
  const piece = steer.ok ? list.pieces.find((entry) => entry.key === steer.plan.target) : null;
  return piece ? [...piece.owns] : [];
}

async function addRequirement(s: Session, list: PieceList, message: MemberMessage) {
  const routed = await routeRequirement(s.deps.db, list, {
    body: message.body,
    files: requirementFiles(list, message.body),
    source: 'user',
  });
  if (routed.to === 'follow_up') return 'added as a follow-up after the pieces land';
  const piece = list.pieces.find((entry) => entry.key === routed.key)!;
  const [runId] = await runningPieceRuns(s.deps.db, piece.id);
  if (runId) await setMessageReader(s.deps.db, message.id, runId);
  return routed.running
    ? `added to ${routed.key}, which is working on those files`
    : `added to ${routed.key}'s brief before it starts`;
}

async function queue(s: Session, message: MemberMessage): Promise<string> {
  await addToQueue(s.deps.db, s.input.identity.threadId, { id: message.id, content: message.body });
  await markMessageSent(s.deps.db, message.id, 'sent', message.id);
  return 'queued as the next message';
}

async function handle(s: Session, listId: string, message: MemberMessage): Promise<void> {
  const list = await pieceListById(s.deps.db, listId);
  if (!list) return;
  const call = await callJev(
    s.jev,
    () => midBuildQuestions(message.body, s.input.userRequest),
    s.control.signal,
  );
  const read = readMidBuild(message.body, call.response);
  const done =
    read.kind === 'question'
      ? await answer(s, list, message)
      : read.kind === 'requirement'
        ? await addRequirement(s, list, message)
        : await queue(s, message);
  await record(s, read, `message during the build read as ${read.kind}: ${done}`);
  await s
    .append(
      runEvents.activity(newId(), MEMBER_MESSAGE_ACTIVITY, {
        ids: [message.id],
        status: 'delivered',
      }),
    )
    .catch(() => undefined);
}

export function watchMidBuild(s: Session, listId: string): MidBuildWatch {
  let work: Promise<void> = Promise.resolve();
  const sweep = () => {
    work = work
      .then(async () => {
        for (const message of await claimChatMessages(s.deps.db, s.lease.runId)) {
          await handle(s, listId, message);
        }
      })
      .catch((error: unknown) =>
        console.error('Could not route a message sent during a build', error),
      );
    return work;
  };
  const timer = setInterval(() => void sweep(), s.deps.inboxPollMs ?? POLL_MS);
  return {
    async stop() {
      clearInterval(timer);
      await sweep();
    },
  };
}
