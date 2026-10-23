import { z } from 'zod';
import { isOk } from '../tickets/http.ts';
import type { ServiceNowClient } from './access.ts';
import { attachmentsQuery } from './query.ts';

const ATTACHMENT_LIMIT = 20;

const attachmentsSchema = z.object({
  result: z.array(z.object({ file_name: z.string(), size_bytes: z.string().optional() })),
});

export async function readAttachments(
  client: ServiceNowClient,
  sysId: string,
): Promise<{ name: string; bytes: number }[]> {
  const answer = await client
    .raw({
      method: 'GET',
      path: '/api/now/attachment',
      query: {
        sysparm_query: attachmentsQuery(sysId),
        sysparm_fields: 'file_name,size_bytes',
        sysparm_limit: String(ATTACHMENT_LIMIT),
      },
    })
    .catch(() => null);
  const parsed = answer && isOk(answer) ? attachmentsSchema.safeParse(answer.data) : null;
  if (!parsed?.success) return [];
  return parsed.data.result.map((entry) => ({
    name: entry.file_name,
    bytes: Math.max(0, Math.round(Number(entry.size_bytes ?? 0)) || 0),
  }));
}
