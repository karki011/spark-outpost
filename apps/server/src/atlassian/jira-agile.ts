import { z } from 'zod';
import type { AtlassianClient } from './access.ts';

const AGILE = '/rest/agile/1.0';

const boardSchema = z.object({
  id: z.number(),
  name: z.string(),
  type: z.string().optional(),
  location: z.object({ projectKey: z.string().optional() }).optional(),
});
const sprintSchema = z.object({
  id: z.number(),
  name: z.string(),
  state: z.string(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  completeDate: z.string().optional(),
  goal: z.string().optional(),
  originBoardId: z.number().optional(),
});
const page = <T extends z.ZodType>(item: T) =>
  z.object({ values: z.array(item), isLast: z.boolean().optional() });

export type JiraSprint = z.infer<typeof sprintSchema>;

export interface SprintInput {
  name?: string | undefined;
  startDate?: string | undefined;
  endDate?: string | undefined;
  goal?: string | undefined;
}

const sprintBody = (input: SprintInput) => ({
  ...(input.name ? { name: input.name } : {}),
  ...(input.startDate ? { startDate: input.startDate } : {}),
  ...(input.endDate ? { endDate: input.endDate } : {}),
  ...(input.goal !== undefined ? { goal: input.goal } : {}),
});

export function jiraAgile(client: AtlassianClient) {
  return {
    async boards(project: string | null) {
      const query = project ? `&projectKeyOrId=${encodeURIComponent(project)}` : '';
      const found = await client.call(
        page(boardSchema),
        { method: 'GET', path: `${AGILE}/board?maxResults=50${query}` },
        'reading the boards',
      );
      return found.values.map((board) => ({
        id: board.id,
        name: board.name,
        type: board.type ?? null,
        project: board.location?.projectKey ?? null,
      }));
    },
    async board(id: number) {
      return client.call(
        boardSchema,
        { method: 'GET', path: `${AGILE}/board/${id}` },
        `reading board ${id}`,
      );
    },
    async sprints(boardId: number, states: string) {
      const found = await client.call(
        page(sprintSchema),
        {
          method: 'GET',
          path: `${AGILE}/board/${boardId}/sprint?maxResults=50&state=${encodeURIComponent(states)}`,
        },
        `reading the sprints of board ${boardId}`,
      );
      return found.values;
    },
    async sprint(id: number): Promise<JiraSprint> {
      return client.call(
        sprintSchema,
        { method: 'GET', path: `${AGILE}/sprint/${id}` },
        `reading sprint ${id}`,
      );
    },
    async moveToSprint(id: number, keys: readonly string[]) {
      await client.call(
        null,
        { method: 'POST', path: `${AGILE}/sprint/${id}/issue`, body: { issues: keys } },
        `moving issues to sprint ${id}`,
      );
    },
    async moveToBacklog(keys: readonly string[]) {
      await client.call(
        null,
        { method: 'POST', path: `${AGILE}/backlog/issue`, body: { issues: keys } },
        'moving issues to the backlog',
      );
    },
    async rank(key: string, other: string, after: boolean) {
      await client.call(
        null,
        {
          method: 'PUT',
          path: `${AGILE}/issue/rank`,
          body: {
            issues: [key],
            ...(after ? { rankAfterIssue: other } : { rankBeforeIssue: other }),
          },
        },
        `ranking ${key}`,
      );
    },
    async createSprint(boardId: number, input: SprintInput): Promise<JiraSprint> {
      return client.call(
        sprintSchema,
        {
          method: 'POST',
          path: `${AGILE}/sprint`,
          body: { originBoardId: boardId, ...sprintBody(input) },
        },
        'creating the sprint',
      );
    },
    async updateSprint(id: number, state: 'active' | 'closed', input: SprintInput) {
      await client.call(
        null,
        { method: 'POST', path: `${AGILE}/sprint/${id}`, body: { state, ...sprintBody(input) } },
        `${state === 'active' ? 'starting' : 'completing'} sprint ${id}`,
      );
    },
  };
}
