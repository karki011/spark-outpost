import { Router, type Response } from 'express';
import { auditLogQuerySchema, type AuditExportLine } from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import { listProtocolLog, protocolLogBatches, verifyRunLog } from '../persistence/audit-log.ts';
import { conversationAuditRuns, summarizeAudit } from '../persistence/audit-summary.ts';
import { costCsv } from '../audit/cost-csv.ts';
import { BadRequestError, paramId } from './validation.ts';

export interface AuditDeps {
  db: Db;
}

async function runExists(db: Db, runId: string): Promise<boolean> {
  const { rowCount } = await db.query('SELECT 1 FROM runs WHERE id = $1', [runId]);
  return rowCount === 1;
}

function notFound(res: Response, what: string) {
  res.status(404).json({ error: `${what} not found.` });
}

async function writeLine(res: Response, line: AuditExportLine): Promise<void> {
  if (res.write(`${JSON.stringify(line)}\n`)) return;
  await new Promise<void>((resolve) => {
    const done = () => {
      res.off('drain', done);
      res.off('close', done);
      resolve();
    };
    res.once('drain', done);
    res.once('close', done);
  });
}

export function auditRoutes({ db }: AuditDeps): Router {
  const router = Router();

  router.get('/runs/:id/audit/log', async (req, res) => {
    const runId = paramId(req);
    const query = auditLogQuerySchema.safeParse(req.query);
    if (!query.success) {
      const fields = query.error.issues.map((issue) => issue.path.join('.')).join(', ');
      throw new BadRequestError(`Invalid query: ${fields}.`);
    }
    if (!(await runExists(db, runId))) return notFound(res, 'Run');
    res.json(await listProtocolLog(db, runId, query.data));
  });

  router.get('/runs/:id/audit/verify', async (req, res) => {
    const runId = paramId(req);
    if (!(await runExists(db, runId))) return notFound(res, 'Run');
    res.json(await verifyRunLog(db, runId));
  });

  router.get('/conversations/:id/audit/summary', async (req, res) => {
    const conversationId = paramId(req);
    const runs = await conversationAuditRuns(db, conversationId);
    if (!runs) return notFound(res, 'Conversation');
    res.json(summarizeAudit(conversationId, runs));
  });

  router.get('/conversations/:id/audit/export.csv', async (req, res) => {
    const conversationId = paramId(req);
    const runs = await conversationAuditRuns(db, conversationId);
    if (!runs) return notFound(res, 'Conversation');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="conversation-${conversationId}-cost.csv"`,
    );
    res.send(costCsv(runs));
  });

  router.get('/conversations/:id/audit/export.jsonl', async (req, res) => {
    const conversationId = paramId(req);
    const runs = await conversationAuditRuns(db, conversationId);
    if (!runs) return notFound(res, 'Conversation');
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="conversation-${conversationId}-audit.jsonl"`,
    );
    for (const run of runs) {
      if (res.destroyed) return;
      await writeLine(res, { type: 'run', ...run });
      for await (const batch of protocolLogBatches(db, run.runId)) {
        for (const entry of batch) {
          if (res.destroyed) return;
          await writeLine(res, { type: 'log', ...entry });
        }
      }
    }
    res.end();
  });

  return router;
}
