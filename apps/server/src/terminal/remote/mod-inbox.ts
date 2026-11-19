import type { PrChecks, TerminalApprovalDecision } from '@spark-outpost/contracts';
import { isRecord } from '../../agent-config/records.ts';
import type { Db } from '../../persistence/db.ts';
import { recordsTerminalLikeChat } from '../../persistence/native-terminal-settings.ts';
import { trackedPullsOf } from '../../persistence/tracked-pulls.ts';
import { remoteAccess } from '../../remote/store.ts';
import type { LiveSession } from '../native-runtime-types.ts';

export const MOD_FRESH_MS = 5_000;
export const FOLLOWED_MS = 30_000;
export const TAKE_WAIT_MS = 3_000;
const FACTS_FRESH_MS = 15_000;

export const ASK_NOTICE = 'Also answerable from Spark on your phone';

export interface ModReply {
  messages: string[];
  notices: string[];
  status: string | null;
  record: boolean;
  abort: string | null;
  askNotice: string | null;
}

export interface StatusFacts {
  phone: boolean;
  approvals: boolean;
  pull: { number: number; state: 'open' | 'merged' | 'closed'; checks: PrChecks } | null;
}

export type SendOutcome = 'taken' | 'refused' | 'not taken';

interface Queued {
  text: string;
  settle: (outcome: Exclude<SendOutcome, 'not taken'>) => void;
}

interface Stop {
  prompt: string;
  settle: () => void;
}

interface ModSession {
  checkedIn: number;
  followed: number;
  aborts: boolean;
  stop: Stop | null;
  queue: Queued[];
  notices: string[];
  facts: { at: number; approvals: boolean; record: boolean; pull: StatusFacts['pull'] } | null;
}

const CHECKS: Record<PrChecks, string | null> = {
  none: null,
  pending: 'checks running',
  passing: 'checks passed',
  failing: 'checks failing',
};

export function modStatus(facts: StatusFacts): string | null {
  const parts: string[] = [];
  if (facts.phone) parts.push('phone connected');
  if (facts.phone && facts.approvals) parts.push('approvals on');
  const pull = facts.pull;
  if (pull?.state === 'open') parts.push(`PR #${pull.number}`, CHECKS[pull.checks] ?? '');
  if (pull?.state === 'merged') parts.push(`PR #${pull.number} merged`);
  const shown = parts.filter(Boolean);
  return shown.length ? `Spark · ${shown.join(' · ')}` : null;
}

export function decisionNotice(decision: TerminalApprovalDecision['decision']): string {
  return decision === 'allow' ? 'Allowed from your phone' : 'Denied from your phone';
}

export interface ModInboxDeps {
  db: Db;
  workspaceId: string;
  waitsForAnswer: (conversationId: string) => Promise<boolean>;
  checkedIn?: (session: LiveSession) => void;
  now?: () => number;
  delay?: (ms: number) => Promise<void>;
}

export function modInbox(deps: ModInboxDeps) {
  const now = deps.now ?? Date.now;
  const delay = deps.delay ?? ((ms: number) => new Promise((done) => setTimeout(done, ms)));
  const sessions = new Map<string, ModSession>();
  const entry = (conversationId: string): ModSession => {
    let found = sessions.get(conversationId);
    if (!found) {
      found = {
        checkedIn: 0,
        followed: 0,
        aborts: false,
        stop: null,
        queue: [],
        notices: [],
        facts: null,
      };
      sessions.set(conversationId, found);
    }
    return found;
  };
  const active = (conversationId: string) => {
    const found = sessions.get(conversationId);
    return found !== undefined && now() - found.checkedIn <= MOD_FRESH_MS;
  };
  const facts = async (conversationId: string, found: ModSession) => {
    if (found.facts && now() - found.facts.at <= FACTS_FRESH_MS) return found.facts;
    const [access, pulls, record] = await Promise.all([
      remoteAccess(deps.db, deps.workspaceId),
      trackedPullsOf(deps.db, deps.workspaceId, conversationId),
      recordsTerminalLikeChat(deps.db, conversationId),
    ]);
    const pull = pulls[0];
    found.facts = {
      at: now(),
      approvals: access.hostname !== null && access.switches.terminalApprove,
      record,
      pull: pull ? { number: pull.number, state: pull.prState, checks: pull.checks } : null,
    };
    return found.facts;
  };

  return {
    active,

    aborts: (conversationId: string) =>
      active(conversationId) && sessions.get(conversationId)?.aborts === true,

    async poll(session: LiveSession, body: unknown = {}): Promise<ModReply | null> {
      if (session.row.provider !== 'claude') return null;
      const conversationId = session.row.conversation_id;
      const found = entry(conversationId);
      found.checkedIn = now();
      found.aborts = isRecord(body) && body.abort === true;
      deps.checkedIn?.(session);
      const known = await facts(conversationId, found);
      const asked = found.queue.length > 0 && (await deps.waitsForAnswer(conversationId));
      const handed = found.queue.splice(0);
      for (const message of handed) message.settle(asked ? 'refused' : 'taken');
      const stop = found.aborts ? found.stop : null;
      found.stop = null;
      stop?.settle();
      return {
        messages: asked ? [] : handed.map((message) => message.text),
        notices: found.notices.splice(0),
        status: modStatus({
          phone: now() - found.followed <= FOLLOWED_MS,
          approvals: known.approvals,
          pull: known.pull,
        }),
        record: known.record,
        abort: stop?.prompt ?? null,
        askNotice: known.approvals ? ASK_NOTICE : null,
      };
    },

    async stop(conversationId: string, prompt: string): Promise<boolean> {
      if (!active(conversationId)) return false;
      const found = entry(conversationId);
      let taken = false;
      let wake = () => undefined as void;
      const handed = new Promise<void>((done) => (wake = done));
      const stop: Stop = {
        prompt,
        settle: () => {
          taken = true;
          wake();
        },
      };
      const earlier = found.stop;
      found.stop = stop;
      earlier?.settle();
      await Promise.race([handed, delay(TAKE_WAIT_MS)]);
      if (found.stop === stop) found.stop = null;
      return taken;
    },

    async send(conversationId: string, text: string): Promise<SendOutcome> {
      if (!active(conversationId)) return 'not taken';
      const found = entry(conversationId);
      let outcome: SendOutcome = 'not taken';
      let wake = () => undefined as void;
      const handed = new Promise<void>((done) => (wake = done));
      const queued: Queued = {
        text,
        settle: (result) => {
          outcome = result;
          wake();
        },
      };
      found.queue.push(queued);
      await Promise.race([handed, delay(TAKE_WAIT_MS)]);
      found.queue = found.queue.filter((item) => item !== queued);
      return outcome;
    },

    followed(conversationId: string): void {
      entry(conversationId).followed = now();
    },

    decided(conversationId: string, decision: TerminalApprovalDecision['decision']): void {
      if (active(conversationId)) entry(conversationId).notices.push(decisionNotice(decision));
    },

    ended(conversationId: string): void {
      sessions.delete(conversationId);
    },
  };
}

export type ModInbox = ReturnType<typeof modInbox>;
