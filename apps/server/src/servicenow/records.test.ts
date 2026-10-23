import { describe, expect, it } from 'vitest';
import { parseJournalText } from './journal.ts';
import { isoTime, priorityRankOf, recordSchema, recordUrl, summaryOf } from './records.ts';
import { isFinalState, serviceNowSettings, serviceNowStatus, stateKind } from './states.ts';

const settings = serviceNowSettings({ statusMap: {}, moveStatuses: {} }, 'incident');
const both = (value: string, display = value) => ({ value, display_value: display });

describe('ServiceNow records', () => {
  it('reads stored UTC times as UTC, not local time', () => {
    expect(isoTime('2026-10-22 09:05:00')).toBe('2026-10-22T09:05:00Z');
    expect(isoTime('22/10/2026 09:05')).toBeNull();
  });

  it('maps priority 1 to 4 and leaves Planning without one', () => {
    expect([1, 2, 3, 4, 5].map((rank) => priorityRankOf(String(rank)))).toEqual([1, 2, 3, 4, 0]);
  });

  it('builds a summary from display values', () => {
    const record = recordSchema.parse({
      sys_id: both('9d385017c611228701d22104cc95c371'),
      number: both('INC0010023'),
      short_description: both('VPN drops'),
      state: both('2', 'In Progress'),
      priority: both('2', '2 - High'),
      assigned_to: both('u1', 'Jordan Lee'),
      assignment_group: both('g1', 'Network Ops'),
      caller_id: both('u2', 'Sam Ortiz'),
      sys_updated_on: both('2026-10-22 09:05:00', '22/10/2026 10:05'),
      sys_created_on: both('2026-10-20 08:00:00'),
      due_date: both('2026-10-30 17:00:00'),
      sys_class_name: both('incident', 'Incident'),
    });
    const summary = summaryOf(record, {
      instanceUrl: 'https://acme.service-now.com',
      table: 'incident',
      settings,
    });
    expect(summary).toMatchObject({
      source: 'servicenow',
      key: 'INC0010023',
      status: 'in_progress',
      statusName: 'In Progress',
      priority: '2 - High',
      priorityRank: 2,
      project: 'incident',
      assignedTo: { id: 'u1', name: 'Jordan Lee' },
      reporter: { name: 'Sam Ortiz' },
      group: 'Network Ops',
      updatedAt: '2026-10-22T09:05:00Z',
      dueDate: '2026-10-30',
    });
    expect(summary.url).toBe(
      recordUrl('https://acme.service-now.com', 'incident', '9d385017c611228701d22104cc95c371'),
    );
  });
});

describe('ServiceNow states', () => {
  it('keeps the instance label and maps it to Spark groups', () => {
    expect(serviceNowStatus('New', settings)).toBe('todo');
    expect(serviceNowStatus('On Hold', settings)).toBe('in_progress');
    expect(serviceNowStatus('Work in Progress', settings)).toBe('in_progress');
    expect(serviceNowStatus('Resolved', settings)).toBe('in_review');
    expect(serviceNowStatus('Closed Complete', settings)).toBe('done');
    expect(serviceNowStatus('Canceled', settings)).toBe('done');
  });

  it('treats resolve, close and cancel as final, whatever group they map to', () => {
    for (const label of ['Resolved', 'Closed', 'Cancelled', 'Canceled', 'Closed Skipped']) {
      expect(isFinalState(label)).toBe(true);
    }
    for (const label of ['New', 'In Progress', 'On Hold', 'Review', 'Scheduled']) {
      expect(isFinalState(label)).toBe(false);
    }
    expect(stateKind('Resolved')).toBe('started');
  });
});

describe('ServiceNow journal text', () => {
  it('splits display-value journals into entries', () => {
    const text =
      '2026-10-22 09:00:00 - Priya Nair (Work notes)\nGateway idle timeout is 1200 s.\n\n2026-10-22 07:00:00 - Jordan Lee (Work notes)\nReproduced.\n\n';
    expect(parseJournalText(text, 'internal')).toEqual([
      {
        author: 'Priya Nair',
        body: 'Gateway idle timeout is 1200 s.',
        createdAt: '2026-10-22T09:00:00Z',
        visibility: 'internal',
      },
      {
        author: 'Jordan Lee',
        body: 'Reproduced.',
        createdAt: '2026-10-22T07:00:00Z',
        visibility: 'internal',
      },
    ]);
    expect(parseJournalText('Just text', 'customer')[0]).toMatchObject({
      author: null,
      body: 'Just text',
      visibility: 'customer',
    });
  });
});
