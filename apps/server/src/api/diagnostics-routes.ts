import { Router } from 'express';
import { diagnosticsFileName } from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';
import { collectDiagnostics, type DiagnosticsSources } from '../diagnostics/collect.ts';
import { diagnosticsEntries } from '../diagnostics/report.ts';
import { zipFiles } from '../diagnostics/zip.ts';

export type DiagnosticsPlaces = Pick<DiagnosticsSources, 'appVersion' | 'logDir' | 'dataDir'>;

export interface DiagnosticsDeps {
  db: Queryable;
  workspaceId: string;
  diagnostics?: DiagnosticsPlaces | undefined;
}

const NO_PLACES: DiagnosticsPlaces = { appVersion: null, logDir: null, dataDir: null };

export async function diagnosticsZip(sources: DiagnosticsSources): Promise<Buffer> {
  const facts = await collectDiagnostics(sources);
  return zipFiles(diagnosticsEntries(facts), facts.createdAt);
}

export function diagnosticsRoutes(deps: DiagnosticsDeps): Router {
  const router = Router();

  router.get('/diagnostics/export', async (_req, res) => {
    const now = new Date();
    const zip = await diagnosticsZip({
      db: deps.db,
      workspaceId: deps.workspaceId,
      ...(deps.diagnostics ?? NO_PLACES),
      now: () => now,
    });
    res
      .status(200)
      .type('application/zip')
      .set('Cache-Control', 'no-store')
      .attachment(diagnosticsFileName(now))
      .send(zip);
  });

  return router;
}
