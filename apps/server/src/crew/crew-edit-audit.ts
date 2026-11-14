import { crewEditAuditFacts, type Approval } from '@spark-outpost/contracts';
import { insertFinishedRunEntries } from '../persistence/audit-log.ts';
import type { Db } from '../persistence/db.ts';

export async function auditCrewDenial(db: Db, approval: Approval): Promise<void> {
  const action = approval.payload.sparkAction;
  if (approval.status !== 'denied' || action?.action !== 'crew_edit') return;
  const payload = {
    action: crewEditAuditFacts(action),
    outcome: 'denied',
    approvalId: approval.id,
  };
  await insertFinishedRunEntries(db, approval.runId, [
    {
      at: new Date(),
      direction: 'harness',
      kind: 'notification',
      method: 'spark/crew_edit',
      rpcId: null,
      sizeBytes: Buffer.byteLength(JSON.stringify(payload)),
      truncated: false,
      payload,
    },
  ]).catch(() => undefined);
}
