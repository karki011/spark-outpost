import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OUTPOST_DRAFT_ACTIVITY } from '@spark-outpost/contracts';
import { proposedAboveOwnMode } from '../src/outposts/mode-cap.ts';
import { updateChatSettings } from '../src/persistence/chat-settings.ts';
import { getDraft } from '../src/persistence/outpost-drafts.ts';
import {
  DRAFT_FROM_REQUEST,
  DRAFT_NEEDS_PROJECT,
  outpostDraftTool,
} from '../src/spark-mcp/tools/outpost-draft-tool.ts';
import { NOT_FOR_PIECES } from '../src/spark-mcp/tools/outpost-turn.ts';
import { addMemberChat, createOutpostRow } from './outpost-fixtures.ts';
import {
  crewRun,
  linkProject,
  memberWithTurn,
  pieceRun,
  projectRow,
  requestStartedTurn,
  toolHarness,
  type MemberTurn,
} from './outpost-tool-support.ts';
import { connectCliProvider, createTestDb, startChat, type TestDb } from './support.ts';

let t: TestDb;
let lead: { conversationId: string; runId: string };
let shop: string;
let docs: string;

interface Drafted {
  draft: string;
  chats: { handle: string; project: string; dependsOn?: string; stacked: boolean; note: string }[];
  next: string;
}

type Turn = Pick<MemberTurn, 'conversationId' | 'runId'>;

const chat = (handle: string, extra: Record<string, unknown> = {}) => ({
  handle,
  title: `${handle} work`,
  project: 'shop',
  task: `Build the ${handle} part.`,
  ...extra,
});

beforeEach(async () => {
  t = await createTestDb();
  shop = await projectRow(t, 'shop');
  docs = await projectRow(t, 'docs');
  lead = await startChat(t, 'plan the checkout story');
  await linkProject(t, lead.conversationId, shop);
});

afterEach(async () => {
  await t.cleanup();
});

function propose(turn: Turn, chats: unknown[], extra: Record<string, unknown> = {}) {
  const harness = toolHarness(t, turn);
  const args = { title: 'Checkout', name: 'Orders launch', chats, ...extra };
  return { harness, result: outpostDraftTool.run(args, harness.context) as Promise<Drafted> };
}

async function count(table: string): Promise<number> {
  const { rows } = await t.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
  return rows[0]!.n;
}

describe('spark_outpost_draft', () => {
  it('saves a proposal and starts nothing', async () => {
    const chats = await count('conversations');
    const { harness, result } = propose(lead, [
      chat('api'),
      chat('web', { dependsOn: 'api' }),
      chat('guide', { project: 'docs', dependsOn: 'api' }),
    ]);
    const drafted = await result;
    const stored = (await getDraft(t.db, t.workspaceId, drafted.draft))!;
    expect(stored).toMatchObject({
      conversationId: lead.conversationId,
      runId: lead.runId,
      outpostId: null,
      title: 'Checkout',
      startedAt: null,
    });
    expect(stored.body).toEqual({
      name: 'Orders launch',
      title: 'Checkout',
      chats: [
        { handle: 'api', title: 'api work', projectId: shop, task: 'Build the api part.' },
        {
          handle: 'web',
          title: 'web work',
          projectId: shop,
          task: 'Build the web part.',
          dependsOn: 'api',
        },
        {
          handle: 'guide',
          title: 'guide work',
          projectId: docs,
          task: 'Build the guide part.',
          dependsOn: 'api',
        },
      ],
    });
    expect(drafted.chats).toEqual([
      expect.objectContaining({ handle: '@api', project: 'shop', stacked: false }),
      expect.objectContaining({ handle: '@web', dependsOn: '@api', stacked: true }),
      expect.objectContaining({
        handle: '@guide',
        project: 'docs',
        dependsOn: '@api',
        stacked: false,
        note: 'different repo: order only, no branch base',
      }),
    ]);
    expect(harness.events).toEqual([
      expect.objectContaining({
        activityType: OUTPOST_DRAFT_ACTIVITY,
        content: { draftId: drafted.draft, chats: 3, stacked: 1 },
      }),
    ]);
    expect(await count('conversations')).toBe(chats);
    expect(await count('outposts')).toBe(0);
    expect(await count('outpost_posts')).toBe(0);
    expect(await count('outpost_story_tasks')).toBe(0);
  });

  it('ties the draft to the outpost the chat is already in and drops the name', async () => {
    const outpostId = await createOutpostRow(t);
    const web = await memberWithTurn(t, outpostId, 'web');
    const drafted = await propose(web, [chat('api')]).result;
    const stored = (await getDraft(t.db, t.workspaceId, drafted.draft))!;
    expect(stored.outpostId).toBe(outpostId);
    expect(stored.body.name).toBeUndefined();
  });

  it('refuses a handle a chat in the outpost already has', async () => {
    const web = await memberWithTurn(t, await createOutpostRow(t), 'web');
    await expect(propose(web, [chat('web')]).result).rejects.toThrow('@web');
    expect(await count('outpost_drafts')).toBe(0);
  });

  it('refuses a ring and names it', async () => {
    const ring = [chat('a1', { dependsOn: 'b1' }), chat('b1', { dependsOn: 'a1' })];
    await expect(propose(lead, ring).result).rejects.toThrow('@a1 → @b1 → @a1');
    expect(await count('outpost_drafts')).toBe(0);
  });

  it('refuses a chat that starts after itself, an unknown one, a repeated handle and an unknown project', async () => {
    const refused = (chats: unknown[]) => expect(propose(lead, chats).result).rejects;
    await refused([chat('api', { dependsOn: 'api' })]).toThrow('@api cannot start after itself.');
    await refused([chat('api', { dependsOn: 'web' })]).toThrow('which is not in this draft');
    await refused([chat('api'), chat('api')]).toThrow('@api is used by more than one chat.');
    await refused([chat('api', { project: 'billing' })]).toThrow('No project called billing');
    expect(await count('outpost_drafts')).toBe(0);
  });

  describe('the mode a chat proposes', () => {
    beforeEach(async () => {
      await connectCliProvider(t, 'claude');
      await updateChatSettings(t.db, lead.conversationId, {
        provider: 'claude',
        agentMode: 'acceptEdits',
      });
    });

    it('cannot ask less often than the proposing chat’s own mode', async () => {
      const over = [chat('api'), chat('web', { agentMode: 'bypassPermissions' })];
      await expect(propose(lead, over).result).rejects.toThrow(proposedAboveOwnMode('web'));
      const other = [chat('api', { agent: 'codex', agentMode: 'agent-full-access' })];
      await expect(propose(lead, other).result).rejects.toThrow(proposedAboveOwnMode('api'));
      expect(await count('outpost_drafts')).toBe(0);
    });

    it('may be the same, ask more often, or be left to the agent’s default', async () => {
      const within = [
        chat('api', { agentMode: 'acceptEdits' }),
        chat('web', { agentMode: 'plan' }),
        chat('ops', { agent: 'codex', agentMode: 'ask-every-action' }),
        chat('guide'),
      ];
      const drafted = await propose(lead, within).result;
      const stored = (await getDraft(t.db, t.workspaceId, drafted.draft))!;
      expect(stored.body.chats.map((each) => each.agentMode)).toEqual([
        'acceptEdits',
        'plan',
        'ask-every-action',
        undefined,
      ]);
      expect(stored.body.chats[2]!.agent).toBe('codex');
    });
  });

  it('refuses from a turn another chat’s request started, not from one the user started from a draft', async () => {
    const outpostId = await createOutpostRow(t);
    const web = await memberWithTurn(t, outpostId, 'web');
    const api = { conversationId: await addMemberChat(t, outpostId, 'api'), handle: 'api' };
    const asked = await requestStartedTurn(t, outpostId, api, 'chat', web);
    await expect(propose(asked, [chat('guide')]).result).rejects.toThrow(DRAFT_FROM_REQUEST);
    const ops = { conversationId: await addMemberChat(t, outpostId, 'ops'), handle: 'ops' };
    const started = await requestStartedTurn(t, outpostId, ops, 'draft', web);
    expect((await propose(started, [chat('guide')]).result).draft).toBeTruthy();
  });

  it('saves a Builder’s or an integrator’s proposal for the chat, under the chat’s own turn', async () => {
    for (const role of ['builder', 'integrator'] as const) {
      const crew = {
        conversationId: lead.conversationId,
        runId: await crewRun(t, lead.runId, role),
      };
      const drafted = await propose(crew, [chat(`${role}-api`)]).result;
      expect(await getDraft(t.db, t.workspaceId, drafted.draft)).toMatchObject({
        conversationId: lead.conversationId,
        runId: lead.runId,
      });
    }
  });

  it('refuses the Builder of a turn another chat’s request started, and the Coordinator', async () => {
    const outpostId = await createOutpostRow(t);
    const web = await memberWithTurn(t, outpostId, 'web');
    const api = { conversationId: await addMemberChat(t, outpostId, 'api'), handle: 'api' };
    const asked = await requestStartedTurn(t, outpostId, api, 'chat', web);
    const builder = { ...asked, runId: await crewRun(t, asked.runId, 'builder') };
    await expect(propose(builder, [chat('guide')]).result).rejects.toThrow(DRAFT_FROM_REQUEST);
    const coordinator = {
      conversationId: lead.conversationId,
      runId: await crewRun(t, lead.runId, 'coordinator'),
    };
    await expect(propose(coordinator, [chat('api')]).result).rejects.toThrow(NOT_FOR_PIECES);
  });

  it('refuses a piece, and a chat with no project that is in no outpost', async () => {
    const piece = { conversationId: lead.conversationId, runId: await pieceRun(t, lead.runId) };
    await expect(propose(piece, [chat('api')]).result).rejects.toThrow(NOT_FOR_PIECES);
    const plain = await startChat(t, 'hello');
    await expect(propose(plain, [chat('api')]).result).rejects.toThrow(DRAFT_NEEDS_PROJECT);
  });

  it('is offered to read-only modes: it is not an action tool', () => {
    expect(outpostDraftTool.acts).toBeUndefined();
    expect(outpostDraftTool.needs).toBe('outpost_draft');
  });
});
