import { z } from 'zod';
import { serviceNowTableNames, type ServiceNowTable } from '@spark-outpost/contracts';
import { isOk } from '../tickets/http.ts';
import { TicketConflictError } from '../tickets/source.ts';
import type { ServiceNowClient } from './access.ts';
import { choicesQuery } from './query.ts';
import { stateOf, type ServiceNowState } from './states.ts';

const choicesSchema = z.object({
  result: z.array(z.object({ value: z.string(), label: z.string() })),
});

export async function readStates(
  client: ServiceNowClient,
  table: ServiceNowTable,
): Promise<ServiceNowState[]> {
  const answer = await client.raw({
    method: 'GET',
    path: '/api/now/table/sys_choice',
    query: {
      sysparm_query: choicesQuery(table),
      sysparm_fields: 'value,label',
      sysparm_limit: '100',
    },
  });
  const parsed = isOk(answer) ? choicesSchema.safeParse(answer.data) : null;
  const choices = parsed?.success ? parsed.data.result : [];
  if (choices.length === 0) {
    const name = serviceNowTableNames[table].toLowerCase();
    throw new TicketConflictError(
      `Spark can't read the ${name} states on this instance (sys_choice), so it can't move this record. Move it in ServiceNow.`,
    );
  }
  const seen = new Set<string>();
  return choices
    .filter((choice) => {
      if (seen.has(choice.value)) return false;
      seen.add(choice.value);
      return true;
    })
    .map((choice) => stateOf(choice.value, choice.label));
}
