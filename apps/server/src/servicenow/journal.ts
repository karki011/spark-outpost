import { z } from 'zod';
import type { TicketComment, TicketCommentVisibility } from '@spark-outpost/contracts';
import { isOk } from '../tickets/http.ts';
import { TicketApiError } from '../tickets/source.ts';
import type { ServiceNowClient } from './access.ts';
import { journalQuery } from './query.ts';
import { isoTime } from './records.ts';

export const JOURNAL_LIMIT = 20;

const journalSchema = z.object({
  result: z.array(
    z.object({
      element: z.string(),
      value: z.string(),
      sys_created_on: z.string(),
      sys_created_by: z.string().optional(),
    }),
  ),
});

const recordJournalSchema = z.object({
  result: z.object({
    work_notes: z.string().optional(),
    comments: z.string().optional(),
  }),
});

const ENTRY_HEAD =
  /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) - (.+?) \((?:Work notes|Additional comments)\)$/m;

const ENTRY_START =
  /(?=^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} - .+? \((?:Work notes|Additional comments)\)$)/m;

const visibilityOf = (element: string): TicketCommentVisibility =>
  element === 'comments' ? 'customer' : 'internal';

export function parseJournalText(
  text: string,
  visibility: TicketCommentVisibility,
): TicketComment[] {
  const entries: TicketComment[] = [];
  const parts = text.split(ENTRY_START);
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const head = ENTRY_HEAD.exec(trimmed);
    const body = head ? trimmed.slice(head[0].length).trim() : trimmed;
    entries.push({
      author: head?.[2] ?? null,
      body,
      createdAt: (head && isoTime(head[1]!)) ?? new Date(0).toISOString(),
      visibility,
    });
  }
  return entries;
}

async function fromJournalTable(client: ServiceNowClient, sysId: string) {
  const answer = await client.raw({
    method: 'GET',
    path: '/api/now/table/sys_journal_field',
    query: {
      sysparm_query: journalQuery(sysId),
      sysparm_fields: 'element,value,sys_created_on,sys_created_by',
      sysparm_limit: String(JOURNAL_LIMIT),
    },
  });
  if (!isOk(answer)) return null;
  const parsed = journalSchema.safeParse(answer.data);
  if (!parsed.success) return null;
  return parsed.data.result.map((entry): TicketComment => ({
    author: entry.sys_created_by ?? null,
    body: entry.value,
    createdAt: isoTime(entry.sys_created_on) ?? new Date(0).toISOString(),
    visibility: visibilityOf(entry.element),
  }));
}

async function fromRecord(client: ServiceNowClient, table: string, sysId: string) {
  const record = await client.call(
    recordJournalSchema,
    {
      method: 'GET',
      path: `/api/now/table/${table}/${sysId}`,
      query: { sysparm_fields: 'work_notes,comments', sysparm_display_value: 'true' },
    },
    'reading work notes and comments',
  );
  return [
    ...parseJournalText(record.result.work_notes ?? '', 'internal'),
    ...parseJournalText(record.result.comments ?? '', 'customer'),
  ];
}

export async function readJournal(
  client: ServiceNowClient,
  table: string,
  sysId: string,
): Promise<TicketComment[]> {
  const entries =
    (await fromJournalTable(client, sysId)) ??
    (await fromRecord(client, table, sysId).catch((error: unknown) => {
      if (error instanceof TicketApiError) return [];
      throw error;
    }));
  return entries.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-JOURNAL_LIMIT);
}
