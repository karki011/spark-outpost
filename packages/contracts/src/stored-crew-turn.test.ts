import { describe, expect, it } from 'vitest';
import { adviceSummarySchema } from './advice.ts';
import { checkpointKindSchema } from './checkpoints.ts';
import { memberMessageSchema } from './crew-messages.ts';
import { decisionKindSchema, orchestrationSchema } from './orchestration.ts';
import { pieceStatusSchema } from './pieces.ts';
import { planLineSchema } from './plans.ts';
import { agentRoleSchema } from './roles.ts';
import stored from './stored-crew-turn.fixture.json' with { type: 'json' };

function withoutRouting<T extends { routing: string }>(record: T): Omit<T, 'routing'> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'routing')) as Omit<
    T,
    'routing'
  >;
}

describe('a crew turn stored before the harness was removed', () => {
  it('was written by the released contracts', () => {
    expect(stored.capturedWith).toContain('0.1.0-beta.11');
  });

  it('still reads whole but for the retired Auto routing: every helper, role, piece, card and Jev decision', () => {
    const read = orchestrationSchema.parse(stored.orchestration);
    expect(stored.orchestration.routing).toBe('auto');
    expect(read).toEqual(withoutRouting(stored.orchestration));
    expect(new Set(read.crew.map((member) => member.role))).toEqual(new Set(stored.roles));
    expect(read.pieces?.pieces.map((piece) => piece.key)).toEqual(['P1', 'P2']);
    expect(read.checkpoints.map((card) => card.kind)).toEqual([
      'accept',
      'merge_conflict',
      'plan',
      'pieces',
      'retry',
      'verify',
      'stuck',
      'ownership',
      'budget',
      'pr_split',
    ]);
    expect(read.decisions.map((decision) => decision.kind)).toEqual(stored.decisionKinds);
    expect(read.totals.byRole).toHaveLength(stored.roles.length);
  });

  it('still reads the intake record, messages to helpers and the saved plan line', () => {
    expect(adviceSummarySchema.parse(stored.advice)).toEqual(withoutRouting(stored.advice));
    expect(stored.memberMessages.map((message) => memberMessageSchema.parse(message))).toEqual(
      stored.memberMessages,
    );
    expect(stored.planLines.map((line) => planLineSchema.parse(line))).toEqual(stored.planLines);
  });

  it('still knows every stored role, card kind, decision kind and piece status', () => {
    expect(stored.roles.map((role) => agentRoleSchema.parse(role))).toEqual(stored.roles);
    expect(stored.checkpointKinds.map((kind) => checkpointKindSchema.parse(kind))).toEqual(
      stored.checkpointKinds,
    );
    expect(stored.decisionKinds.map((kind) => decisionKindSchema.parse(kind))).toEqual(
      stored.decisionKinds,
    );
    expect(stored.pieceStatuses.map((status) => pieceStatusSchema.parse(status))).toEqual(
      stored.pieceStatuses,
    );
  });
});
