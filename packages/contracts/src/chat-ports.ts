import { z } from 'zod';

export const chatPortsResponseSchema = z.object({
  ports: z.record(z.uuid(), z.array(z.number().int().min(1).max(65_535))),
});
export type ChatPortsResponse = z.infer<typeof chatPortsResponseSchema>;
