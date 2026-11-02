import { describe, expect, it } from 'vitest';
import {
  serviceNowAnswers,
  serviceNowAsksAlways,
  serviceNowAuditFacts,
  type ServiceNowEditAction,
} from './servicenow-actions.ts';
import { sparkActionSchema } from './spark-actions.ts';

function serviceNowEdit(overrides: Partial<ServiceNowEditAction> = {}): ServiceNowEditAction {
  return {
    action: 'servicenow_edit',
    op: 'work_note',
    record: {
      table: 'incident',
      number: 'INC0010023',
      sysId: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
      title: 'VPN drops every 20 minutes',
      url: 'https://acme.service-now.com/nav_to.do?uri=incident.do',
      caller: 'Sam Ortiz',
    },
    updated: '2026-10-20 14:03:11',
    changes: {},
    before: null,
    after: null,
    note: 'Raised the idle timeout.',
    move: null,
    ...overrides,
  };
}

const move = (to: string, final: boolean) => ({
  from: 'In Progress',
  to,
  value: '6',
  final,
  closeCode: final ? 'Solved (Permanently)' : null,
  closeNotes: final ? 'Raised the gateway idle timeout to 8 h.' : null,
});

describe('ServiceNow edit cards', () => {
  it('asks in every mode only for a comment the caller sees and a final move', () => {
    expect(serviceNowAsksAlways(serviceNowEdit())).toBe(false);
    expect(serviceNowAsksAlways(serviceNowEdit({ op: 'comment' }))).toBe(true);
    expect(serviceNowAsksAlways(serviceNowEdit({ op: 'move', move: move('Resolved', true) }))).toBe(
      true,
    );
    expect(serviceNowAsksAlways(serviceNowEdit({ op: 'move', move: move('On Hold', false) }))).toBe(
      false,
    );
    expect(serviceNowAsksAlways({ action: 'jira_edit' })).toBe(false);
  });

  it('names the verb on the buttons', () => {
    expect(serviceNowAnswers(serviceNowEdit({ op: 'comment' }))).toMatchObject({
      confirm: 'Post comment',
      decline: 'Don’t post',
    });
    expect(serviceNowAnswers(serviceNowEdit({ op: 'move', move: move('Resolved', true) }))).toEqual(
      { question: 'Resolve INC0010023?', confirm: 'Resolve', decline: 'Don’t resolve' },
    );
    expect(
      serviceNowAnswers(serviceNowEdit({ op: 'move', move: move('Canceled', true) })).confirm,
    ).toBe('Cancel');
  });

  it('audits names and lengths, never the note or close notes', () => {
    const facts = serviceNowAuditFacts(
      serviceNowEdit({ op: 'move', move: move('Resolved', true) }),
    );
    expect(JSON.stringify(facts)).not.toContain('idle timeout');
    expect(facts).toMatchObject({ table: 'incident', number: 'INC0010023', to: 'Resolved' });
    expect(JSON.stringify(serviceNowAuditFacts(serviceNowEdit()))).not.toContain('Raised');
  });

  it('is a Spark action the card schema accepts', () => {
    expect(sparkActionSchema.parse(serviceNowEdit()).action).toBe('servicenow_edit');
  });
});
