import { describe, expect, it } from 'vitest';
import type { ProviderCapabilities, SubChatPiece } from '@spark-outpost/contracts';
import { FAKE_CLAUDE_MODES, FAKE_CODEX_MODES } from '../providers/fake.ts';
import { proposedAboveOwnMode } from './mode-cap.ts';
import {
  folderMissing,
  planSubChats,
  startChoices,
  type PlanAgent,
  type PlanFacts,
  type PlanParent,
} from './plan.ts';
import { modeChoices } from './proposed-mode.ts';

const SHOP = '30000000-0000-4000-8000-000000000001';
const SITE = '30000000-0000-4000-8000-000000000002';

function capabilities(
  provider: 'claude' | 'codex',
  modes: ProviderCapabilities['modes'],
  defaultMode: string,
): ProviderCapabilities {
  return {
    provider,
    models: [],
    efforts: [],
    defaultModel: null,
    modes,
    defaultMode,
    options: [],
    capturedAt: '2026-11-20T10:00:00.000Z',
  };
}

const claude: PlanAgent = {
  id: 'claude',
  name: 'Claude',
  models: [
    { id: 'opus', label: 'Opus 4.5' },
    { id: 'sonnet', label: 'Sonnet 4.5' },
  ],
  efforts: ['low', 'medium', 'high'],
  modes: modeChoices('claude', FAKE_CLAUDE_MODES),
  capabilities: capabilities('claude', FAKE_CLAUDE_MODES, 'default'),
};

const codex: PlanAgent = {
  id: 'codex',
  name: 'Codex',
  models: [{ id: 'gpt-5', label: 'GPT-5' }],
  efforts: ['minimal', 'medium'],
  modes: modeChoices('codex', FAKE_CODEX_MODES),
  capabilities: capabilities('codex', FAKE_CODEX_MODES, 'agent'),
};

const parent: PlanParent = {
  projectId: SHOP,
  provider: 'claude',
  model: 'opus',
  effort: 'high',
  agentMode: 'auto',
  level: 'full-auto',
  posture: 'auto',
};

function facts(overrides: Partial<PlanFacts> = {}): PlanFacts {
  let next = 0;
  return {
    parent,
    projects: [
      { id: SHOP, name: 'shop', folderExists: true },
      { id: SITE, name: 'site', folderExists: true },
    ],
    agents: [claude, codex],
    existingTitles: [],
    newId: () => `id-${(next += 1)}`,
    ...overrides,
  };
}

function piece(title: string, plan: Partial<SubChatPiece> = {}): SubChatPiece {
  return { title, task: `Build ${title}.`, startsAfter: [], ...plan };
}

function plan(pieces: SubChatPiece[], overrides: Partial<PlanFacts> = {}) {
  const result = planSubChats(pieces, facts(overrides));
  if (result.kind === 'refusal') throw new Error(result.message);
  return result.pieces;
}

function refusal(pieces: SubChatPiece[], overrides: Partial<PlanFacts> = {}): string {
  const result = planSubChats(pieces, facts(overrides));
  return result.kind === 'refusal' ? result.message : '';
}

describe('a plan of sub-chats', () => {
  it('copies the parent chat’s project, agent, model, effort, mode and autonomy', () => {
    expect(plan([piece('Orders API')])).toEqual([
      {
        conversationId: 'id-1',
        title: 'Orders API',
        task: 'Build Orders API.',
        project: { id: SHOP, name: 'shop' },
        provider: 'claude',
        agentName: 'Claude',
        model: 'opus',
        effort: 'high',
        agentMode: 'auto',
        level: 'full-auto',
        sameAsParent: true,
        stackedOn: null,
        startsAfter: [],
      },
    ]);
  });

  it('takes the choices the agent makes per piece, by id or by name', () => {
    const [web] = plan([
      piece('Web', {
        project: 'Site',
        model: 'Sonnet 4.5',
        effort: 'LOW',
        mode: 'Accept edits',
        autonomy: 'hands-off',
      }),
    ]);
    expect(web).toMatchObject({
      project: { id: SITE, name: 'site' },
      model: 'sonnet',
      effort: 'low',
      agentMode: 'acceptEdits',
      level: 'hands-off',
      sameAsParent: false,
    });
  });

  it('links pieces by title, with a stack implying the wait', () => {
    const [api, web, docs] = plan([
      piece('Orders API'),
      piece('Orders page', { stackedOn: 'orders api', startsAfter: ['Orders API'] }),
      piece('Docs', { startsAfter: ['Orders API', 'Orders page', 'Orders API'] }),
    ]);
    expect(api).toMatchObject({ stackedOn: null, startsAfter: [] });
    expect(web).toMatchObject({ stackedOn: 'id-1', startsAfter: [] });
    expect(docs).toMatchObject({ stackedOn: null, startsAfter: ['id-1', 'id-2'] });
  });

  it('refuses a title used twice, in the call or by an earlier sub-chat', () => {
    expect(refusal([piece('Web'), piece('web')])).toContain('“web” is used by more than one piece');
    expect(refusal([piece('Web')], { existingTitles: ['WEB'] })).toContain(
      'already has a sub-chat called “Web”',
    );
  });

  it('refuses a wait on a piece that is not in the call, or on itself', () => {
    expect(refusal([piece('Web', { startsAfter: ['API'] })])).toBe(
      '“Web” waits for “API”, which is not a piece in this call.',
    );
    expect(refusal([piece('Web', { stackedOn: 'Web' })])).toBe('“Web” cannot wait for itself.');
  });

  it('refuses pieces that wait for each other, naming the loop', () => {
    const message = refusal([
      piece('A', { startsAfter: ['C'] }),
      piece('B', { stackedOn: 'A' }),
      piece('C', { startsAfter: ['B'] }),
      piece('D'),
    ]);
    expect(message).toBe(
      'These pieces wait for each other: “A” → “C” → “B” → “A”. Remove one stackedOn or startsAfter.',
    );
  });

  it('stacks only inside one repository', () => {
    expect(refusal([piece('API'), piece('Web', { project: 'site', stackedOn: 'API' })])).toContain(
      '“Web” can be stacked on “API” only in the same repository',
    );
    expect(
      plan([piece('API'), piece('Web', { project: 'site', startsAfter: ['API'] })]),
    ).toHaveLength(2);
  });

  it('refuses a project that does not exist or whose folder is gone', () => {
    expect(refusal([piece('Web', { project: 'blog' })])).toBe(
      '“Web”: no project called blog. Projects: shop, site.',
    );
    const projects = [{ id: SHOP, name: 'shop', folderExists: false }];
    expect(refusal([piece('Web')], { projects })).toBe(folderMissing('shop'));
  });

  it('refuses an agent, model, effort or mode the provider does not offer', () => {
    expect(refusal([piece('Web', { agent: 'gemini' })])).toBe(
      '“Web”: gemini is not a connected agent. Agents: claude, codex.',
    );
    expect(refusal([piece('Web', { model: 'haiku' })])).toBe(
      '“Web”: Claude has no model called haiku. Models: opus, sonnet.',
    );
    expect(refusal([piece('Web', { effort: 'max' })])).toBe(
      '“Web”: Claude has no effort called max. Efforts: low, medium, high.',
    );
    expect(refusal([piece('Web', { mode: 'Turbo' })])).toContain(
      '“Web”: "Turbo" is not a mode of this agent. Modes: Manual (default)',
    );
  });
});

describe('the mode cap', () => {
  it('refuses the whole call for a proposed mode above the parent’s', () => {
    const message = refusal([piece('API'), piece('Web', { mode: 'bypassPermissions' })]);
    expect(message).toBe(proposedAboveOwnMode('“Web”'));
    expect(
      plan([piece('Web', { mode: 'bypassPermissions' })], {
        parent: { ...parent, agentMode: 'bypassPermissions', posture: 'full_access' },
      })[0]?.agentMode,
    ).toBe('bypassPermissions');
  });

  it('refuses another agent’s proposed mode that asks less often', () => {
    const asking = { ...parent, agentMode: 'default', posture: 'asks' as const };
    expect(
      refusal([piece('Web', { agent: 'codex', mode: 'Full access' })], { parent: asking }),
    ).toBe(proposedAboveOwnMode('“Web”'));
  });

  it('maps an inherited mode down for another agent, and drops the parent’s model', () => {
    const asking = { ...parent, agentMode: 'default', posture: 'asks' as const };
    const [web] = plan([piece('Web', { agent: 'codex' })], { parent: asking });
    expect(web).toMatchObject({
      provider: 'codex',
      agentName: 'Codex',
      model: null,
      agentMode: 'ask-every-action',
      sameAsParent: false,
    });
    const [auto] = plan([piece('Web', { agent: 'Codex' })]);
    expect(auto?.agentMode).toBeNull();
  });

  it('keeps the parent’s own mode for its own agent, whatever it is', () => {
    const bypass = { ...parent, agentMode: 'bypassPermissions', posture: 'full_access' as const };
    expect(plan([piece('Web')], { parent: bypass })[0]?.agentMode).toBe('bypassPermissions');
  });
});

describe('effort', () => {
  it('falls back to the first offered effort when the parent’s is not offered', () => {
    expect(plan([piece('Web', { agent: 'codex' })])[0]?.effort).toBe('minimal');
    const medium = { ...parent, effort: 'medium' };
    expect(plan([piece('Web', { agent: 'codex' })], { parent: medium })[0]?.effort).toBe('medium');
  });

  it('stays the agent’s default when the parent has none', () => {
    expect(plan([piece('Web')], { parent: { ...parent, effort: null } })[0]?.effort).toBeNull();
  });
});

describe('the choices a piece starts with after the card', () => {
  const [web] = plan([piece('Web')]);

  it('keeps an offered model and effort', () => {
    expect(startChoices({ ...web!, model: 'sonnet', effort: 'low' }, claude)).toEqual({
      model: 'sonnet',
      effort: 'low',
    });
  });

  it('falls back to the first offered effort and refuses a model the agent lacks', () => {
    expect(startChoices({ ...web!, effort: 'max' }, claude)).toEqual({
      model: 'opus',
      effort: 'low',
    });
    expect(startChoices({ ...web!, model: 'gpt-5' }, claude)).toEqual({
      problem: 'Claude has no model called gpt-5.',
    });
  });

  it('refuses an agent that is no longer connected', () => {
    expect(startChoices(web!, undefined)).toEqual({ problem: 'Claude is no longer connected.' });
  });
});
