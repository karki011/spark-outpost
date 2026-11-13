import { z } from 'zod';
import {
  scheduleSlotsSchema,
  workflowRunSchema,
  workflowScheduleViewSchema,
  workflowSchedulesSchema,
  type ScheduleSlot,
  type WorkflowRun,
  type WorkflowSchedule,
  type WorkflowScheduleView,
  type WorkflowSchedules,
} from '@spark-outpost/contracts';
import { request } from '../api/client.ts';

const runsSchema = z.object({ runs: z.array(workflowRunSchema) });

export const scheduleKeys = {
  all: ['crew-workflow-schedules'] as const,
  one: (id: string) => ['crew-workflow-schedules', id] as const,
  history: (id: string) => ['crew-workflow-schedules', id, 'history'] as const,
};

export interface ScheduleHistory {
  runs: WorkflowRun[];
  slots: ScheduleSlot[];
}

export const scheduleApi = {
  list: async (): Promise<WorkflowSchedules['schedules']> =>
    (await request(workflowSchedulesSchema, '/workflow-schedules')).schedules,
  get: (id: string): Promise<WorkflowScheduleView> =>
    request(workflowScheduleViewSchema, `/workflows/${id}/schedule`),
  save: (id: string, schedule: WorkflowSchedule): Promise<WorkflowScheduleView> =>
    request(workflowScheduleViewSchema, `/workflows/${id}/schedule`, {
      method: 'PUT',
      body: JSON.stringify(schedule),
    }),
  history: async (id: string): Promise<ScheduleHistory> => {
    const [runs, slots] = await Promise.all([
      request(runsSchema, `/workflows/${id}/runs`),
      request(scheduleSlotsSchema, `/workflows/${id}/schedule/slots`),
    ]);
    return { runs: runs.runs, slots: slots.slots };
  },
};
