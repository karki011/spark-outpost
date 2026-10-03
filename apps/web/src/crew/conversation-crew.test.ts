import { describe, expect, it } from 'vitest';
import type { ConversationDetail } from '@spark-outpost/contracts';
import {
  crewOrchestration,
  lastCrewOrchestration,
  tvCrew,
  tvOrchestration,
} from './conversation-crew.ts';
import { member, orchestration } from './test-orchestration.ts';

const CREW_RUN = '00000000-0000-4000-8000-000000000001';
const SOLO_RUN = '00000000-0000-4000-8000-000000000009';

function detail(): ConversationDetail {
  const crew = orchestration({ status: 'succeeded', crew: [member({ name: 'Bolt' })] });
  const solo = orchestration({
    runId: SOLO_RUN,
    depth: 'direct',
    crew: [member({ runId: SOLO_RUN, role: 'scout', name: 'Wren' })],
  });
  return {
    runs: [{ id: CREW_RUN }, { id: SOLO_RUN }],
    orchestrations: { [CREW_RUN]: crew, [SOLO_RUN]: solo },
    activity: {},
  } as unknown as ConversationDetail;
}

describe('the crew Agent TV shows', () => {
  it('keeps showing the last crew while a solo answer follows it', () => {
    expect(crewOrchestration(detail())).toBeNull();
    expect(lastCrewOrchestration(detail())?.runId).toBe(CREW_RUN);
    expect(tvCrew(detail()).map((agent) => agent.name)).toEqual(['Jev', 'Bolt']);
  });

  it('shows the single agent in a chat that never had a crew', () => {
    const solo = { ...detail(), runs: [{ id: SOLO_RUN }] } as unknown as ConversationDetail;
    expect(lastCrewOrchestration(solo)).toBeNull();
    expect(tvOrchestration(solo)?.runId).toBe(SOLO_RUN);
    expect(tvCrew(solo).map((agent) => agent.name)).toEqual(['Jev', 'Wren']);
  });

  it('shows nothing before the first reply', () => {
    const empty = { ...detail(), runs: [], orchestrations: {} } as unknown as ConversationDetail;
    expect(tvCrew(empty)).toEqual([]);
    expect(tvCrew(undefined)).toEqual([]);
  });
});
