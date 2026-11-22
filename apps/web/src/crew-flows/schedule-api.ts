import {
  scheduleSlotsSchema,
  workflowScheduleViewSchema,
  workflowSchedulesSchema,
  type ScheduleSlot,
  type WorkflowSchedule,
  type WorkflowScheduleView,
  type WorkflowSchedules,
} from '@spark-outpost/contracts';
import { request } from '../api/client.ts';

export const scheduleKeys = {
  all: ['crew-workflow-schedules'] as const,
  one: (id: string) => ['crew-workflow-schedules', id] as const,
  slots: (id: string) => ['crew-workflow-schedules', id, 'slots'] as const,
};

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
  slots: async (id: string): Promise<ScheduleSlot[]> =>
    (await request(scheduleSlotsSchema, `/workflows/${id}/schedule/slots`)).slots,
};
