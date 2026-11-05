import { expect, type Page } from '@playwright/test';
import type { TicketInbox } from '../../packages/contracts/src/ticket-inbox.ts';
import { chainRows } from '../../apps/server/src/audit/hash-chain.ts';
import { openTestDb } from './database.ts';
import { seedChats, type SeedChat } from './sidebar-seed.ts';
import { connectTickets } from './ticket-seed.ts';

export const TOUR_CHATS = 50;
export const TOUR_TICKETS = 200;
export const TOUR_SPARKS = 16;
export const TOUR_AUDIT_ROWS = 2_000;

const TOPICS = [
  'Fix image uploads',
  'Speed up the test suite',
  'Add a currency column to the invoice export',
  'Tidy the date helpers',
  'Move settings into one module',
];

function tourChat(index: number): SeedChat {
  const title = `${TOPICS[index % TOPICS.length]} ${index + 1}`;
  if (index < 4) return { title, run: { status: 'running' }, minutesAgo: index };
  if (index < 7) {
    return {
      title,
      run: { status: 'awaiting_approval' },
      approval: { kind: 'execute', title: 'pnpm test', command: 'pnpm test' },
      minutesAgo: index,
    };
  }
  if (index < 10) return { title, run: { status: 'failed', error: 'Tests failed' }, unread: true };
  return { title, run: { status: 'succeeded' }, minutesAgo: index * 37, archived: index >= 42 };
}

export function seedTourChats(): Promise<string[]> {
  return seedChats(Array.from({ length: TOUR_CHATS }, (_, index) => tourChat(index)));
}

export async function seedSparks(page: Page): Promise<void> {
  for (let index = 0; index < TOUR_SPARKS; index++) {
    const response = await page.request.post('/api/teammates', {
      data: { name: `Spark ${index + 1}`, role: `Helper ${index + 1}` },
    });
    expect(response.status()).toBe(201);
  }
}

function inflateInbox(inbox: TicketInbox): TicketInbox {
  const [first] = inbox.tickets;
  if (!first) return inbox;
  const tickets = Array.from({ length: TOUR_TICKETS }, (_, index) => {
    const base = inbox.tickets[index % inbox.tickets.length]!;
    const key = `TOUR-${index + 1}`;
    return { ...base, key, title: `${base.title} (${index + 1})`, url: `${base.url}#${key}` };
  });
  return { ...inbox, tickets };
}

export async function serveBigInbox(page: Page): Promise<void> {
  await connectTickets(page, ['linear']);
  await page.route('**/api/tickets/inbox', async (route) => {
    const response = await route.fetch();
    const inbox = (await response.json()) as TicketInbox;
    await route.fulfill({ response, json: inflateInbox(inbox) });
  });
}

function auditPayload(index: number) {
  return {
    jsonrpc: '2.0',
    method: 'session/update',
    params: {
      sessionId: 'sess_tour',
      update: {
        sessionUpdate: index % 3 === 0 ? 'tool_call' : 'agent_message_chunk',
        title: `Read src/area-${index % 40}/part-${index}.ts`,
        content: { type: 'text', text: `Step ${index}: ${'checked the date helper. '.repeat(6)}` },
      },
    },
  };
}

export async function seedLongAudit(): Promise<void> {
  const db = openTestDb();
  try {
    const { rows } = await db.query<{ id: string; started_at: Date }>(
      'SELECT id, started_at FROM runs ORDER BY created_at DESC LIMIT 1',
    );
    const run = rows[0]!;
    const start = run.started_at.getTime();
    const hashed = chainRows(
      null,
      Array.from({ length: TOUR_AUDIT_ROWS }, (_, index) => {
        const payload = auditPayload(index);
        return {
          runId: run.id,
          at: new Date(start + index * 50).toISOString(),
          direction: 'from_agent' as const,
          kind: 'notification',
          method: 'session/update',
          rpcId: null,
          sizeBytes: JSON.stringify(payload).length,
          truncated: false,
          payload,
        };
      }),
    );
    for (let offset = 0; offset < hashed.length; offset += 200) {
      const batch = hashed.slice(offset, offset + 200);
      const values: unknown[] = [];
      const tuples = batch.map((row, index) => {
        values.push(
          row.runId,
          row.seq,
          row.at,
          row.direction,
          row.kind,
          row.method,
          row.rpcId,
          row.sizeBytes,
          row.truncated,
          JSON.stringify(row.payload),
          row.prevHash,
          row.hash,
        );
        const at = index * 12;
        return `(${Array.from({ length: 12 }, (_, column) => `$${at + column + 1}`).join(', ')})`;
      });
      await db.query(
        `INSERT INTO run_protocol_log (run_id, seq, at, direction, kind, method, rpc_id,
           size_bytes, truncated, payload, prev_hash, hash) VALUES ${tuples.join(', ')}`,
        values,
      );
    }
  } finally {
    await db.end();
  }
}
