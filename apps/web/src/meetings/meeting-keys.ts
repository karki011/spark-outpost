export const meetingKeys = {
  all: ['meetings'] as const,
  status: ['meetings', 'status'] as const,
  lists: ['meetings', 'list'] as const,
  list: (query: string) => ['meetings', 'list', query] as const,
  detail: (id: string) => ['meetings', 'detail', id] as const,
  forEvents: (eventKeys: readonly string[]) => ['meetings', 'for-events', eventKeys] as const,
  lines: (id: string) => ['meeting-lines', id] as const,
};
