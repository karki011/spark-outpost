import { describe, expect, it } from 'vitest';
import type { DraftChat, ProviderCapabilities, ProviderSetup } from '@spark-outpost/contracts';
import {
  API_PROJECT,
  CODEX_CAPABILITIES,
  countingIds,
  createData,
} from './create/create-fixtures.ts';
import { cappedMode, fromDraft, type DraftLead } from './draft-prefill.ts';
import { DOCS_CHAT, FE_CHAT, OUTPOST_ID, WEB_PROJECT, chat } from './test-fixtures.ts';

const DRAFT_ID = '0e100000-0000-4000-8000-000000000001';

const CLAUDE_CAPABILITIES: ProviderCapabilities = {
  ...CODEX_CAPABILITIES,
  provider: 'claude',
  modes: [
    { id: 'plan', label: 'Plan', description: null, kind: null },
    { id: 'default', label: 'Manual', description: null, kind: null },
    { id: 'acceptEdits', label: 'Accept edits', description: null, kind: null },
    { id: 'auto', label: 'Auto', description: null, kind: null },
    { id: 'bypassPermissions', label: 'Bypass permissions', description: null, kind: null },
  ],
  defaultMode: 'auto',
};

const CLAUDE_SETUP = { id: 'claude', name: 'Claude', connection: {} } as unknown as ProviderSetup;

function base() {
  const data = createData();
  return {
    ...data,
    chats: [...data.chats, chat(DOCS_CHAT, { title: 'Checkout plan', projectIds: [WEB_PROJECT] })],
    providers: [...data.providers, CLAUDE_SETUP],
    capabilitiesOf: (provider: string) =>
      provider === 'claude' ? CLAUDE_CAPABILITIES : data.capabilitiesOf('codex'),
  };
}

function proposed(handle: string, overrides: Partial<DraftChat> = {}): DraftChat {
  return {
    handle,
    title: `Build ${handle}`,
    projectId: API_PROJECT,
    task: `Do the ${handle} part.`,
    ...overrides,
  };
}

function source(chats: DraftChat[], name?: string) {
  return { id: DRAFT_ID, body: { title: 'Checkout', chats, ...(name ? { name } : {}) } };
}

function lead(posture: DraftLead['posture'], outpost: DraftLead['outpost'] = null): DraftLead {
  return { conversationId: DOCS_CHAT, posture, outpost };
}

describe('cappedMode', () => {
  it('keeps a mode that asks at least as often as the lead', () => {
    expect(cappedMode('claude', 'default', CLAUDE_CAPABILITIES, 'edits')).toBe('default');
    expect(cappedMode('claude', 'acceptEdits', CLAUDE_CAPABILITIES, 'edits')).toBe('acceptEdits');
  });

  it('keeps no mode when the agent default is within the lead', () => {
    expect(cappedMode('claude', null, CLAUDE_CAPABILITIES, 'auto')).toBeNull();
  });

  it('lowers a mode above the lead to the highest one the lead allows', () => {
    expect(cappedMode('claude', 'bypassPermissions', CLAUDE_CAPABILITIES, 'edits')).toBe(
      'acceptEdits',
    );
    expect(cappedMode('claude', null, CLAUDE_CAPABILITIES, 'read_only')).toBe('plan');
    expect(cappedMode('codex', 'agent', CODEX_CAPABILITIES, 'asks')).toBe('read-only');
  });

  it('treats a lead in an unknown mode as one that asks', () => {
    expect(cappedMode('claude', 'auto', CLAUDE_CAPABILITIES, 'unknown')).toBe('default');
  });

  it('never raises: with no lower mode known it keeps what was wanted', () => {
    expect(cappedMode('claude', null, undefined, 'read_only')).toBeNull();
    expect(cappedMode('claude', 'auto', undefined, 'read_only')).toBe('auto');
  });
});

describe('fromDraft', () => {
  it('lists the lead as an existing chat and each proposed chat as a new one', () => {
    const draft = fromDraft(
      source([proposed('api'), proposed('fe', { projectId: WEB_PROJECT })], 'Orders launch'),
      base(),
      lead('auto'),
      countingIds(),
    );
    expect(draft.name).toBe('Orders launch');
    expect(draft.origin).toEqual({ draftId: DRAFT_ID, leadChatId: DOCS_CHAT });
    expect(draft.into).toBeUndefined();
    expect(draft.chats.map((row) => [row.kind, row.handle, row.touched, row.open])).toEqual([
      ['existing', 'web', true, false],
      ['new', 'api', true, false],
      ['new', 'fe', true, false],
    ]);
    expect(draft.chats[0]?.chatId).toBe(DOCS_CHAT);
    expect(draft.chats[1]).toMatchObject({
      projectId: API_PROJECT,
      text: 'Do the api part.',
      provider: 'codex',
      agentMode: 'agent',
      level: null,
      dependsOn: null,
    });
  });

  it('names the outpost after the story when the draft has no name', () => {
    expect(fromDraft(source([proposed('api')]), base(), lead('auto')).name).toBe('Checkout');
  });

  it('turns a starts-after handle into the key of that chat', () => {
    const draft = fromDraft(
      source([proposed('api'), proposed('fe', { dependsOn: 'api' })]),
      base(),
      lead('auto'),
    );
    const [, api, fe] = draft.chats;
    expect(fe?.dependsOn).toBe(api?.key);
    expect(api?.dependsOn).toBeNull();
  });

  it('keeps the mode the lead proposed and never one above the lead', () => {
    const chats = [
      proposed('a', { agent: 'claude', agentMode: 'plan' }),
      proposed('b', { agent: 'claude' }),
      proposed('c', { agent: 'claude', agentMode: 'bypassPermissions' }),
      proposed('d'),
    ];
    const modes = (posture: DraftLead['posture']) =>
      fromDraft(source(chats), base(), lead(posture))
        .chats.slice(1)
        .map((row) => row.agentMode);
    expect(modes('full_access')).toEqual(['plan', null, 'bypassPermissions', 'agent']);
    expect(modes('edits')).toEqual(['plan', 'acceptEdits', 'acceptEdits', 'read-only']);
    expect(modes('read_only')).toEqual(['plan', 'plan', 'plan', 'read-only']);
  });

  it('falls back to the default agent when the proposed one is not connected', () => {
    const data = { ...base(), providers: createData().providers };
    const draft = fromDraft(source([proposed('a', { agent: 'claude' })]), data, lead('auto'));
    expect(draft.chats[1]).toMatchObject({ provider: 'codex', agentMode: 'agent' });
  });

  it("proposes each chat with the lead chat's agent and model, not the default one", () => {
    const claude = { provider: 'claude' as const, model: 'claude-sonnet-5-5', agentMode: 'auto' };
    const chats = [proposed('a'), proposed('b', { agent: 'codex' })];
    const draft = fromDraft(source(chats), base(), { ...lead('auto'), agent: claude });
    expect(draft.chats[1]).toMatchObject(claude);
    expect(draft.chats[2]).toMatchObject({ provider: 'codex', agentMode: 'agent' });
  });

  it('falls back to the default agent when the lead chat has none connected', () => {
    const data = { ...base(), providers: createData().providers };
    const claude = { provider: 'claude' as const, model: null, agentMode: null };
    const draft = fromDraft(source([proposed('a')]), data, { ...lead('auto'), agent: claude });
    expect(draft.chats[1]).toMatchObject({ provider: 'codex', agentMode: 'agent' });
  });

  it('carries the title the lead gave each chat', () => {
    const draft = fromDraft(source([proposed('api'), proposed('fe')]), base(), lead('auto'));
    expect(draft.chats.map((row) => row.storyTitle)).toEqual([undefined, 'Build api', 'Build fe']);
  });

  it('leaves the project empty when it no longer exists', () => {
    const gone = '0d000000-0000-4000-8000-000000000099';
    const draft = fromDraft(source([proposed('a', { projectId: gone })]), base(), lead('auto'));
    expect(draft.chats[1]?.projectId).toBeNull();
  });

  it('adds to the outpost the lead is in, without listing the lead again', () => {
    const outpost = {
      outpostId: OUTPOST_ID,
      name: 'Usage by user',
      members: [
        { conversationId: DOCS_CHAT, handle: 'lead' },
        { conversationId: FE_CHAT, handle: 'fe' },
      ],
    };
    const draft = fromDraft(source([proposed('api')], 'Ignored'), base(), lead('auto', outpost));
    expect(draft.name).toBe('Usage by user');
    expect(draft.into).toEqual(outpost);
    expect(draft.chats.map((row) => row.handle)).toEqual(['api']);
  });

  it('keeps the lead handle clear of the proposed handles', () => {
    const draft = fromDraft(source([proposed('web')]), base(), lead('auto'));
    expect(draft.chats.map((row) => row.handle)).toEqual(['web2', 'web']);
    expect(draft.chats[0]?.chatId).toBe(DOCS_CHAT);
  });
});
